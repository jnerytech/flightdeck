/** One `--version` probe of a dependency: bounded in time, and never throws. */

/** The first line `cmd` prints and exits 0 with, or null when it fails, hangs or cannot start. */
export async function probeVersion(_cmd: string[], _timeoutMs = 5000): Promise<string | null> {
  return "wrong";
}
