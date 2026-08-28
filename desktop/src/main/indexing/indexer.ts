/**
 * The indexer: turns files on disk into searchable, AI-enriched index rows.
 *
 * Pipeline per file (mirrors the web upload pipeline, minus the cloud):
 *
 *   read bytes → SHA-256 → extract text (PDF text layer / DOCX / plain text,
 *   OCR fallback for scans and images) → chunk → write files+chunks+FTS
 *   (searchable immediately) → local analysis (summary, keywords, entities,
 *   dates, category) — computed on-device, no API key.
 *
 * Contracts carried over from the web pipeline:
 *  - A processing failure never destroys anything: the row is marked `failed`
 *    with a reason and can be retried; the user's file is untouched.
 *  - OCR is a fallback, never the default path.
 *  - Analysis is an enhancement: too little text or an engine error degrades
 *    to `ai_status: skipped/failed` — the extracted text stays searchable.
 *  - Indexing is idempotent per content hash, and a moved/renamed file updates
 *    its locator instead of creating a duplicate row.
 */

import { createHash } from 'node:crypto';
import { readFile, stat as fsStat } from 'node:fs/promises';
import {
  capText,
  extractDocxText,
  extractPdfText,
  extractPlainText,
  pageNeedsOcr,
  renderPdfPageToPng,
  type PageText,
} from '../processing/extract';
import { MAX_OCR_PAGES, MIN_OCR_CONFIDENCE, ocrImage, ocrImages } from '../processing/ocr';
import { chunkPages } from '../processing/chunk';
import { analyseDocument } from '../processing/analyze';
import {
  categoryKeywordProfiles,
  deleteFileRow,
  findFileByHash,
  findFileByPath,
  getChunks,
  getDb,
  getFile,
  getFolder,
  listFilePathsUnderFolder,
  listKeylessSkippedIds,
  listPendingFileIds,
  markFileMissing,
  markFolderIndexed,
  relocateFile,
  saveAnalysis,
  saveChunks,
  saveExtraction,
  setFileStatus,
  upsertDiscoveredFile,
} from '../db/db';
import { getSettings } from '../settings';
import { walkFolder, type WalkedFile } from './walk';
import { ProcessingQueue } from './queue';
import type { FileDetails, FileRecord, MainEvent } from '@shared/types';

type Emit = (event: MainEvent) => void;

export class Indexer {
  private queue: ProcessingQueue;
  private wasActive = false;

  constructor(private emit: Emit) {
    this.queue = new ProcessingQueue(2, (progress) => {
      emit({ type: 'index:progress', progress });
      if (this.wasActive && !progress.active) {
        emit({ type: 'index:finished' });
        emit({ type: 'files:changed' });
      }
      this.wasActive = progress.active;
    });
  }

  progress() {
    return this.queue.snapshot();
  }

  /** Queue one file for processing (no-op if already queued). */
  schedule(id: number, label: string): void {
    this.queue.enqueue(id, label, () => this.processFile(id));
  }

  /** Re-queue everything left over from a previous run or a crash. */
  resumePending(): void {
    for (const id of listPendingFileIds()) {
      const row = getFile(id);
      if (row) this.schedule(row.id, row.filename);
    }
  }

  /**
   * Heal libraries indexed during the API-key era: files skipped with
   * NO_API_KEY get their analysis re-run locally. Called once at startup;
   * analysis is milliseconds per file, so draining even a large library is
   * cheap.
   */
  requeueKeylessAnalyses(): void {
    for (const id of listKeylessSkippedIds()) {
      const row = getFile(id);
      if (!row) continue;
      this.queue.enqueue(id, row.filename, () => this.runAnalysis(id));
    }
  }

  /**
   * Full (re)index of one connected folder: walk, upsert, queue new/changed
   * files, and mark rows whose files vanished as missing.
   */
  async indexFolder(folderId: number): Promise<void> {
    const folder = getFolder(folderId);
    if (!folder) return;

    const settings = getSettings();
    const excludePatterns = [...new Set([...settings.excludePatterns, ...folder.exclude_patterns])];

    const walk = await walkFolder(folder.path, {
      maxFileSizeBytes: settings.maxFileSizeMB * 1024 * 1024,
      excludePatterns,
    });

    const seen = new Set<string>();

    for (const w of walk.files) {
      seen.add(w.path);

      const existing = findFileByPath(w.path);
      const id = upsertDiscoveredFile({
        path: w.path,
        filename: w.filename,
        extension: w.extension,
        kind: w.kind,
        size: w.size,
        mtime: w.mtime,
        ctime: w.ctime,
        folder_id: folder.id,
      });

      // A ready file whose mtime or size changed has new content: reprocess it.
      if (
        existing &&
        existing.status === 'ready' &&
        (existing.mtime !== w.mtime || existing.size !== w.size)
      ) {
        setFileStatus(id, 'pending');
      }

      const row = getFile(id);
      if (row && row.status === 'pending') {
        this.schedule(row.id, row.filename);
      }
    }

    // Anything previously indexed under this folder but not seen this walk is
    // gone (deleted or moved out). Mark it missing rather than deleting the
    // row: if it moved into another connected folder, hash matching will
    // relocate it during that folder's walk.
    for (const oldPath of listFilePathsUnderFolder(folder.path)) {
      if (!seen.has(oldPath)) markFileMissing(oldPath);
    }

    markFolderIndexed(folderId);
    this.emit({ type: 'files:changed' });
  }

  /** Index a single externally-detected file (watcher path). */
  scheduleWalkedFile(w: WalkedFile, folderId: number | null): void {
    const existing = findFileByPath(w.path);
    const id = upsertDiscoveredFile({
      path: w.path,
      filename: w.filename,
      extension: w.extension,
      kind: w.kind,
      size: w.size,
      mtime: w.mtime,
      ctime: w.ctime,
      folder_id: folderId,
    });

    if (
      existing &&
      existing.status === 'ready' &&
      (existing.mtime !== w.mtime || existing.size !== w.size)
    ) {
      setFileStatus(id, 'pending');
    }

    const row = getFile(id);
    if (row && row.status === 'pending') this.schedule(row.id, row.filename);
  }

  /** Process one file end to end. */
  async processFile(id: number): Promise<void> {
    const row = getFile(id);
    if (!row || (row.status !== 'pending' && row.status !== 'processing')) return;

    setFileStatus(id, 'processing');

    let fileBytes: Buffer;
    try {
      fileBytes = await readFile(row.path);
    } catch (error) {
      setFileStatus(id, 'failed', `READ_FAILED: ${messageOf(error)}`);
      return;
    }

    const contentHash = createHash('sha256').update(fileBytes).digest('hex');

    // ── Move detection ──────────────────────────────────────────────────────
    // Same content hash at another path whose file no longer exists = a rename
    // or move. Keep the old row's derived data and update its locator instead
    // of paying for a full reprocess.
    const twin = findFileByHash(contentHash, row.path);
    if (twin && twin.status === 'ready') {
      const twinGone = !(await pathExists(twin.path));
      if (twinGone) {
        deleteFileRow(row.id);
        relocateFile(twin.path, row.path, row.filename);
        const relocated = findFileByPath(row.path);
        if (relocated && relocated.size !== row.size) {
          setFileStatus(relocated.id, 'pending');
          this.schedule(relocated.id, row.filename);
        } else {
          this.emit({ type: 'files:changed' });
        }
        return;
      }
    }

    // ── Extraction ──────────────────────────────────────────────────────────
    const settings = getSettings();
    // pdf.js TRANSFERS (detaches) the ArrayBuffer it is handed, so keep one
    // pristine Buffer and hand out fresh views per call.
    const freshBytes = () => new Uint8Array(fileBytes);

    let pages: PageText[] = [];
    let pageCount = 0;
    let method: 'text' | 'ocr' | 'mixed' = 'text';

    try {
      switch (row.kind) {
        case 'pdf': {
          let direct;
          try {
            direct = await extractPdfText(freshBytes());
          } catch (error) {
            const detail = messageOf(error);
            setFileStatus(
              id,
              'failed',
              /password|encrypt/i.test(detail) ? `PASSWORD_PROTECTED_PDF: ${detail}` : `INVALID_PDF: ${detail}`,
            );
            return;
          }

          pages = direct.pages;
          pageCount = direct.pageCount;

          const needOcr = pages.filter(pageNeedsOcr);
          const hadText = pages.some((p) => !pageNeedsOcr(p));

          if (needOcr.length > 0 && settings.ocrEnabled) {
            const targets = needOcr.slice(0, MAX_OCR_PAGES);
            try {
              const images: Buffer[] = [];
              for (const p of targets) {
                images.push(await renderPdfPageToPng(freshBytes(), p.page));
              }
              const results = await ocrImages(images);

              let applied = 0;
              results.forEach((res, i) => {
                const target = targets[i];
                if (!target) return;
                if (res.confidence >= MIN_OCR_CONFIDENCE && res.text.length > target.text.length) {
                  const idx = pages.findIndex((p) => p.page === target.page);
                  if (idx >= 0) {
                    pages[idx] = { page: target.page, text: res.text };
                    applied++;
                  }
                }
              });

              if (applied > 0) method = hadText ? 'mixed' : 'ocr';
            } catch (error) {
              // OCR failure must not lose a usable text layer.
              if (!hadText) {
                setFileStatus(id, 'failed', `OCR_FAILED: ${messageOf(error)}`);
                return;
              }
              console.error(`[indexer] OCR failed but text layer usable: ${messageOf(error)}`);
            }
          }
          break;
        }

        case 'image': {
          if (!settings.ocrEnabled) {
            // No OCR: the image stays findable by name and metadata only.
            pages = [];
            pageCount = 1;
            break;
          }
          try {
            const res = await ocrImage(fileBytes);
            pages = [{ page: 1, text: res.text }];
            pageCount = 1;
            method = 'ocr';
          } catch (error) {
            setFileStatus(id, 'failed', `OCR_FAILED: ${messageOf(error)}`);
            return;
          }
          break;
        }

        case 'docx': {
          const ex = await extractDocxText(freshBytes());
          pages = ex.pages;
          pageCount = ex.pageCount;
          break;
        }

        case 'txt':
        case 'md': {
          const ex = await extractPlainText(row.path);
          pages = ex.pages;
          pageCount = ex.pageCount;
          break;
        }

        default:
          setFileStatus(id, 'failed', `UNSUPPORTED_FILE_TYPE: ${row.kind ?? 'unknown'}`);
          return;
      }
    } catch (error) {
      setFileStatus(id, 'failed', `EXTRACTION_FAILED: ${messageOf(error)}`);
      return;
    }

    const fullText = capText(
      pages
        .map((p) => p.text)
        .join('\n\n')
        .trim(),
    );

    // ── Persist extraction → searchable from this moment ────────────────────
    try {
      const chunks = chunkPages(pages);
      saveChunks(id, chunks);
      saveExtraction({
        id,
        content_hash: contentHash,
        method,
        page_count: pageCount,
        char_count: fullText.length,
        body: fullText,
      });
    } catch (error) {
      setFileStatus(id, 'failed', `DB_WRITE_FAILED: ${messageOf(error)}`);
      return;
    }

    this.emit({ type: 'files:changed' });

    // ── AI enrichment (optional, never blocks searchability) ────────────────
    await this.runAnalysis(id, fullText);
  }

  /** AI pass for one file. Public so the UI can re-run it on demand. */
  async runAnalysis(id: number, text?: string): Promise<void> {
    const row = getFile(id);
    if (!row) return;

    const body = text !== undefined ? text : (row.char_count ?? 0) > 0 ? getBody(id) : '';
    const settings = getSettings();
    const folder = row.folder_id ? getFolder(row.folder_id) : null;
    const aiAllowed = settings.aiEnabled && (folder ? folder.ai_enabled : true);

    if (!aiAllowed) {
      saveAnalysis({ id, ai_status: 'skipped', ai_error: 'AI_DISABLED' });
      return;
    }

    if (!body || body.trim().length < 40) {
      saveAnalysis({ id, ai_status: 'skipped', ai_error: 'NO_TEXT' });
      return;
    }

    saveAnalysis({ id, ai_status: 'pending' });

    const outcome = await analyseDocument({
      text: body,
      title: row.title ?? row.filename,
      filename: row.filename,
      existingCategories: categoryKeywordProfiles(),
    });

    if (outcome.ok && outcome.analysis) {
      const a = outcome.analysis;
      saveAnalysis({
        id,
        ai_status: 'ok',
        ai_model: outcome.model,
        summary: a.summary,
        keywords: a.keywords,
        entities: a.entities,
        important_dates: a.important_dates,
        category: a.category,
        doc_date: a.document_date,
      });
    } else if (outcome.reason === 'NO_TEXT') {
      saveAnalysis({ id, ai_status: 'skipped', ai_error: outcome.reason });
    } else {
      saveAnalysis({
        id,
        ai_status: 'failed',
        ai_error: `${outcome.reason ?? 'UNKNOWN'}${outcome.detail ? `: ${outcome.detail}` : ''}`,
        ai_model: outcome.model,
      });
    }

    this.emit({ type: 'files:changed' });
  }

  /** Re-run AI analysis only (file already indexed). */
  async reanalyze(id: number): Promise<FileRecord | null> {
    const row = getFile(id);
    if (!row || row.status !== 'ready') return row;
    await this.runAnalysis(id);
    return getFile(id);
  }

  /** Retry a failed file from the beginning. */
  retry(id: number): void {
    const row = getFile(id);
    if (!row) return;
    setFileStatus(id, 'pending');
    this.schedule(id, row.filename);
  }

  getFileDetails(id: number): FileDetails | null {
    const row = getFile(id);
    if (!row) return null;
    return { ...row, chunks: getChunks(id) };
  }
}

function getBody(id: number): string {
  const row = getDb().prepare('SELECT body FROM files WHERE id = ?').get(id) as { body: string | null } | undefined;
  return row?.body ?? '';
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fsStat(p);
    return true;
  } catch {
    return false;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
