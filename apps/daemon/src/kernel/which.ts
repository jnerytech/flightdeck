/**
 * Finds an executable on the *current* PATH. `Bun.which(name)` alone keeps the PATH the process
 * started with, which ignores later changes (such as the test guard against the real claude).
 */
export function whichOnPath(name: string): string | null {
  return Bun.which(name, { PATH: process.env.PATH ?? "" });
}
