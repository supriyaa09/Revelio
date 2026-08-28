import { normalize } from './extract';

/**
 * OCR is a FALLBACK, never the default path. It is only invoked for pages whose
 * text layer is missing or too thin (see pageNeedsOcr), and for uploaded images,
 * which have no text layer by definition.
 *
 * The worker is created per call and always terminated: a leaked tesseract
 * worker holds a child process and ~30 MB for the lifetime of the server.
 *
 * Desktop note: `eng.traineddata` ships inside the app's resources directory so
 * OCR works with no network at all. `setOcrLangPath()` points the worker at it
 * at startup; if it is unset we fall back to tesseract's default (CDN fetch).
 */
export interface OcrResult {
  text: string;
  confidence: number;
}

let langPath: string | null = null;

/** Point OCR at a local directory containing eng.traineddata (offline mode). */
export function setOcrLangPath(dir: string | null): void {
  langPath = dir;
}

function workerOptions(): Record<string, unknown> {
  return langPath ? { langPath, gzip: false } : {};
}

/** Pages beyond this are not OCR'd, to bound worst-case processing time. */
export const MAX_OCR_PAGES = 15;

/** Below this mean confidence we treat the OCR output as unusable. */
export const MIN_OCR_CONFIDENCE = 30;

export async function ocrImage(image: Buffer | Uint8Array): Promise<OcrResult> {
  // Lazy import: tesseract.js pulls a wasm core and downloads language data on
  // first use, so a document with a good text layer must never trigger it.
  const { createWorker } = await import('tesseract.js');

  const worker = await createWorker('eng', 1, workerOptions());
  try {
    const { data } = await worker.recognize(Buffer.from(image));
    return { text: normalize(data.text ?? ''), confidence: data.confidence ?? 0 };
  } finally {
    // finally, not after: a recognise failure must still release the worker.
    await worker.terminate();
  }
}

/**
 * OCRs several images with one worker rather than one per page — worker startup
 * dominates the cost for multi-page documents.
 */
export async function ocrImages(
  images: Buffer[],
  onProgress?: (done: number, total: number) => void,
): Promise<OcrResult[]> {
  if (images.length === 0) return [];

  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng', 1, workerOptions());
  const out: OcrResult[] = [];

  try {
    for (const [i, image] of images.entries()) {
      try {
        const { data } = await worker.recognize(image);
        out.push({ text: normalize(data.text ?? ''), confidence: data.confidence ?? 0 });
      } catch (error) {
        // One unreadable page must not abort the whole document.
        console.error(`[ocr] page ${i + 1} failed:`, error instanceof Error ? error.message : error);
        out.push({ text: '', confidence: 0 });
      }
      onProgress?.(i + 1, images.length);
    }
  } finally {
    await worker.terminate();
  }

  return out;
}
