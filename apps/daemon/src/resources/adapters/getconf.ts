/**
 * The machine's `getconf` as a process (#1612): the one place the resources domain starts it, to
 * learn the page size and the clock ticks the `/proc` numbers are counted in.
 */

/** Asks `getconf`; null when it is not there or answers something else. */
export async function getconf(
  name: "PAGESIZE" | "CLK_TCK",
  spawn: typeof Bun.spawn = Bun.spawn,
): Promise<number | null> {
  try {
    const child = spawn(["getconf", name], { stdout: "pipe", stderr: "ignore" });
    const [text, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    const value = Number.parseInt(text.trim(), 10);
    return code === 0 && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}
