/**
 * Bounded FIFO processing queue.
 *
 * Extraction and OCR are CPU-heavy; AI calls are latency-heavy. Running them
 * with a small fixed concurrency keeps the UI responsive while a large folder
 * is being indexed. The queue is the single place that knows how much work is
 * outstanding, which is what the renderer's progress bar reads.
 */

import type { IndexProgress } from '@shared/types';

type Task = () => Promise<void>;

export class ProcessingQueue {
  private queue: { id: number; run: Task }[] = [];
  private running = 0;
  private done = 0;
  private failed = 0;
  private total = 0;
  private current: string | null = null;
  private enqueuedIds = new Set<number>();

  constructor(
    private concurrency: number = 2,
    private onProgress: (progress: IndexProgress) => void = () => {},
  ) {}

  /** Enqueue a file unless it is already queued. Returns true if added. */
  enqueue(id: number, label: string, run: Task): boolean {
    if (this.enqueuedIds.has(id)) return false;
    this.enqueuedIds.add(id);
    this.total++;
    this.queue.push({
      id,
      run: async () => {
        this.current = label;
        try {
          await run();
          this.done++;
        } catch (error) {
          this.failed++;
          console.error(`[queue] task for file ${id} failed:`, error);
        } finally {
          this.enqueuedIds.delete(id);
          this.current = null;
        }
      },
    });
    this.pump();
    return true;
  }

  private pump(): void {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const task = this.queue.shift()!;
      this.running++;
      this.emit();
      void task.run().finally(() => {
        this.running--;
        this.emit();
        if (this.queue.length === 0 && this.running === 0) {
          this.onProgress(this.snapshot());
        }
        this.pump();
      });
    }
    this.emit();
  }

  private emit(): void {
    this.onProgress(this.snapshot());
  }

  snapshot(): IndexProgress {
    return {
      active: this.running > 0 || this.queue.length > 0,
      queued: this.queue.length,
      done: this.done,
      failed: this.failed,
      total: this.total,
      current: this.current,
    };
  }

  /** Reset cumulative counters — used when a fresh indexing run starts. */
  resetCounters(): void {
    this.done = 0;
    this.failed = 0;
    this.total = this.queue.length + this.running;
    this.emit();
  }
}
