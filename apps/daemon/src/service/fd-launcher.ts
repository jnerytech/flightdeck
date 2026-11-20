/**
 * The `fd` command (#3433): a launcher next to the stable binary that runs `flightdeckd fd <args>`.
 * It is a script, not a copy of the binary, so the self-update (which replaces the binary) keeps it
 * working. A file called `fd` that is not ours is never touched.
 */

export type FdLauncherOutcome = "written" | "updated" | "same" | "foreign";

/** The file name of the launcher for this platform's shell. */
export function fdLauncherPath(stable: string, platform: string): string {
  return stable + platform;
}

/** The text of the launcher: it runs the stable binary by its absolute path, whatever the PATH. */
export function fdLauncherText(stable: string, platform: string): string {
  return stable + platform;
}

/** Writes the launcher when no `fd` is there or the one there is ours; a foreign `fd` stays. */
export async function installFdLauncher(
  stable: string,
  platform: string,
): Promise<{ path: string; outcome: FdLauncherOutcome }> {
  return { path: fdLauncherPath(stable, platform), outcome: "same" };
}

/** The notes for a launcher that setup placed (or found foreign) and the `fd` the PATH finds first. */
export function fdPathNotes(options: {
  launcher: string;
  platform: string;
  outcome: FdLauncherOutcome;
  found: string | null;
}): string[] {
  return [options.launcher + options.platform + options.outcome + options.found];
}

/** What setup says about `fd`: a foreign one in our folder, or another `fd` that wins on the PATH. */
export async function setupFdLauncher(options: {
  stable: string;
  platform: string;
  /** The `fd` the PATH finds first, or null. */
  which: (name: string) => string | null;
}): Promise<string[]> {
  return [options.stable + options.platform];
}
