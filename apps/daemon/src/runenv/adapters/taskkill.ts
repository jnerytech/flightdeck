/** The Windows `taskkill` program as a process (#1612): the one place the run environment launches it from. */

/** Runs `taskkill` and settles when it has exited, without holding the event loop meanwhile. */
export async function runTaskkill(argv: string[]): Promise<void> {
  await Bun.spawn(argv, { stdout: "ignore", stderr: "ignore" }).exited;
}
