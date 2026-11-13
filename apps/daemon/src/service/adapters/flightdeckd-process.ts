/**
 * The flightdeckd binary as a process (#1612): the one place the service domain runs it, to ask
 * which version it is. The update and the setup get back the version string, never the output.
 */

const VERSION_LINE = /^flightdeckd (\d+\.\d+\.\d+)/;

/** What `<bin> --version` says, or null when it does not answer like flightdeckd in time. */
export async function binaryVersion(bin: string, timeoutMs: number): Promise<string | null> {
  try {
    const proc = Bun.spawn([bin, "--version"], {
      stdout: "pipe",
      stderr: "ignore",
      stdin: "ignore",
      env: process.env,
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    const done = await Promise.race([proc.exited.then(() => true), late]);
    clearTimeout(timer);
    if (!done) {
      proc.kill();
      return null;
    }
    return VERSION_LINE.exec(await new Response(proc.stdout).text())?.[1] ?? null;
  } catch {
    return null;
  }
}
