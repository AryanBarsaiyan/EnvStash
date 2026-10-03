export function uid() { return Math.random().toString(36).slice(2, 10); }

// ── Safe JSON parse ───────────────────────────────────────────────
export function safeJson<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

export function errorMessage(err: unknown): string {
  return (err as { message?: string })?.message ?? String(err);
}

/**
 * Runs async jobs strictly one after another, in the order they were added.
 * A job that fails rejects its own promise but does not stop the jobs behind it.
 */
export class SerialQueue {
  private _tail: Promise<unknown> = Promise.resolve();

  add<T>(job: () => Promise<T> | T): Promise<T> {
    const run = this._tail.then(job);
    this._tail = run.catch(() => undefined);
    return run;
  }

  /** Resolves once everything added so far has finished. */
  idle(): Promise<unknown> { return this._tail; }
}
