import type { PageText } from './extract';

export interface Chunk {
  chunk_index: number;
  page_start: number | null;
  page_end: number | null;
  content: string;
}

/** Target chunk size in characters, with overlap to avoid splitting mid-idea. */
export const CHUNK_CHARS = 1_800;
export const CHUNK_OVERLAP = 200;
export const MAX_CHUNKS = 400;

/**
 * Splits page text into retrieval chunks while tracking which pages each chunk
 * spans, so a future citation can point at a real page rather than a guess.
 *
 * Chunks are built by accumulating whole pages until the size target is hit;
 * a single page larger than the target is split internally on paragraph, then
 * sentence, then hard character boundaries.
 */
export function chunkPages(pages: PageText[]): Chunk[] {
  const chunks: Chunk[] = [];
  let buffer = '';
  let bufferStart: number | null = null;
  let bufferEnd: number | null = null;

  const flush = () => {
    const content = buffer.trim();
    if (content.length > 0 && chunks.length < MAX_CHUNKS) {
      chunks.push({
        chunk_index: chunks.length,
        page_start: bufferStart,
        page_end: bufferEnd,
        content,
      });
    }
    buffer = '';
    bufferStart = null;
    bufferEnd = null;
  };

  for (const page of pages) {
    const text = page.text.trim();
    if (!text) continue;

    if (text.length > CHUNK_CHARS) {
      // Page alone exceeds the target: flush what we have, then split the page.
      flush();
      for (const piece of splitLongText(text)) {
        if (chunks.length >= MAX_CHUNKS) return chunks;
        chunks.push({
          chunk_index: chunks.length,
          page_start: page.page,
          page_end: page.page,
          content: piece,
        });
      }
      continue;
    }

    if (buffer.length + text.length > CHUNK_CHARS && buffer.length > 0) {
      const tail = buffer.slice(-CHUNK_OVERLAP);
      const carriedEnd = bufferEnd;
      flush();
      // Carry a short overlap so a sentence spanning a boundary stays findable.
      buffer = tail;
      bufferStart = carriedEnd;
      bufferEnd = carriedEnd;
    }

    buffer = buffer ? `${buffer}\n\n${text}` : text;
    bufferStart ??= page.page;
    bufferEnd = page.page;

    if (chunks.length >= MAX_CHUNKS) return chunks;
  }

  flush();
  return chunks;
}

function splitLongText(text: string): string[] {
  const out: string[] = [];
  let rest = text;

  while (rest.length > 0) {
    if (rest.length <= CHUNK_CHARS) {
      out.push(rest);
      break;
    }

    const window = rest.slice(0, CHUNK_CHARS);
    // Prefer a paragraph break, then a sentence end, then give up and hard-cut.
    let cut = window.lastIndexOf('\n\n');
    if (cut < CHUNK_CHARS * 0.5) cut = window.lastIndexOf('. ');
    if (cut < CHUNK_CHARS * 0.5) cut = window.lastIndexOf(' ');
    if (cut <= 0) cut = CHUNK_CHARS;

    out.push(rest.slice(0, cut).trim());

    // The advance must always be positive. Subtracting the overlap
    // unconditionally meant that a cut point at or below CHUNK_OVERLAP produced
    // slice(0) — the same string again — spinning until MAX_CHUNKS with
    // identical duplicated content. Skip the overlap rather than stall.
    const step = cut > CHUNK_OVERLAP ? cut - CHUNK_OVERLAP : cut;
    rest = rest.slice(step).trim();

    if (out.length >= MAX_CHUNKS) break;
  }

  return out.filter((s) => s.length > 0);
}
