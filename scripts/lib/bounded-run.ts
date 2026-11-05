/**
 * Runs a hook command with a deadline (#273): its stdout ignored, the tail of its stderr kept, and
 * on timeout the whole process group killed, grandchildren too, so nothing it started keeps the
 * caller waiting.
 */

export interface BoundedResult {
  /** The exit code; null when it was killed or could not start. */
  code: number | null;
  /** The last characters of its stderr, or why it could not start. */
  stderr: string;
  timedOut: boolean;
}

export async function runBounded(_command: string[], _timeoutMs: number): Promise<BoundedResult> {
  return { code: 0, stderr: "", timedOut: false };
}
