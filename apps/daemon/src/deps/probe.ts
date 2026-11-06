/** One `--version` probe of a dependency: bounded in time, and never throws. */

/** The first line `cmd` prints and exits 0 with, or null when it fails, hangs or cannot start. */
export async function probeVersion(cmd: string[], timeoutMs = 5000): Promise<string | null> {
  let proc: ReturnType<typeof Bun.spawn> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // ENOENT, ENOEXEC and EACCES (a shim whose interpreter is gone, a file that is not executable) throw here.
    const child = Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore", stdin: "ignore" });
    proc = child;
    const killed = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        child.kill();
        resolve(null);
      }, timeoutMs);
    });
    const answer = (async () => {
      const [stdout, code] = await Promise.all([
        new Response(child.stdout as ReadableStream).text(),
        child.exited,
      ]);
      return code === 0 ? (stdout.split("\n")[0] ?? null) : null;
    })();
    return await Promise.race([answer, killed]);
  } catch {
    proc?.kill();
    return null;
  } finally {
    clearTimeout(timer);
  }
}
