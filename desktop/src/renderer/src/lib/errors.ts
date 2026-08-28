/** Turns an unknown IPC/async rejection into a one-line user-facing message. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
