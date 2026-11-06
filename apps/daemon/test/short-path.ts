/**
 * The 8.3 form of a path on Windows (`C:\Users\RUNNER~1\...`), the way a task registered from an
 * 8.3 TEMP names the daemon. cmd's `%~s` gives it in about 15 ms; the PowerShell and COM object the
 * test used before took seconds to start on a Windows CI runner.
 *
 * `windowsVerbatimArguments`: Bun would otherwise quote the argument for the C runtime (`\"`), which
 * cmd does not read. As one line, the quotes around the path reach cmd as they are, so spaces and
 * parentheses in it are fine. A `%` in the path would be expanded by cmd: the tests' paths have none.
 */
export function shortPath(path: string): string {
  const out = Bun.spawnSync(["cmd.exe", "/d", "/c", `for %I in ("${path}") do @echo %~sI`], {
    stdout: "pipe",
    stderr: "pipe",
    windowsVerbatimArguments: true,
  });
  if (out.exitCode !== 0) {
    throw new Error(`cmd %~s of ${path} exited with ${out.exitCode}: ${out.stderr.toString()}`);
  }
  return out.stdout.toString().trim();
}
