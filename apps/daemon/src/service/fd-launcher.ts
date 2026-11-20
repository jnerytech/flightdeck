/**
 * The `fd` command (#3433): a launcher next to the stable binary that runs `flightdeckd fd <args>`.
 * It is a script, not a copy of the binary, so the self-update (which replaces the binary) keeps it
 * working. A file called `fd` that is not ours is never touched.
 */
import { lstat, readFile, rename, rm, writeFile } from "node:fs/promises";
import { posix, win32 } from "node:path";

export type FdLauncherOutcome = "written" | "updated" | "same" | "foreign" | "failed";

/** A line in the launcher that tells our file from someone else's `fd`. */
const MARK = "flightdeck fd launcher";

const pathApi = (platform: string) => (platform === "win32" ? win32 : posix);

/** The file name of the launcher for this platform's shell, in the folder of the stable binary. */
export function fdLauncherPath(stable: string, platform: string): string {
  const api = pathApi(platform);
  return api.join(api.dirname(stable), platform === "win32" ? "fd.cmd" : "fd");
}

/** The text of the launcher: it runs the stable binary by its absolute path, whatever the PATH. */
export function fdLauncherText(stable: string, platform: string): string {
  if (platform === "win32") {
    // A percent sign inside a batch file is doubled; a Windows path has no quote.
    const exe = stable.replaceAll("%", "%%");
    return `@echo off\r\nREM ${MARK}\r\n"${exe}" fd %*\r\n`;
  }
  return `#!/bin/sh\n# ${MARK}\nexec '${stable.replaceAll("'", String.raw`'\''`)}' fd "$@"\n`;
}

/** Ours when the second line is our marker: a script that only mentions it is someone else's. */
function isOurs(content: string): boolean {
  const second = content.split(/\r?\n/)[1];
  return second === `# ${MARK}` || second === `REM ${MARK}`;
}

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

type Installed = { path: string; outcome: FdLauncherOutcome; error?: string };

async function replaceOurs(path: string, text: string): Promise<Installed> {
  const next = `${path}.new`;
  try {
    await rm(next, { force: true });
    await writeFile(next, text, { mode: 0o755, flag: "wx" });
    await rename(next, path);
    return { path, outcome: "updated" };
  } catch (error) {
    await rm(next, { force: true }).catch(() => undefined);
    return { path, outcome: "failed", error: reason(error) };
  }
}

/** Writes the launcher when no `fd` is there or the one there is ours; a foreign `fd` stays. */
export async function installFdLauncher(stable: string, platform: string): Promise<Installed> {
  const path = fdLauncherPath(stable, platform);
  const text = fdLauncherText(stable, platform);
  const found = await lstat(path).catch(() => null);
  if (found === null) {
    try {
      // `wx` creates it or fails: a file that appears meanwhile is not overwritten.
      await writeFile(path, text, { mode: 0o755, flag: "wx" });
      return { path, outcome: "written" };
    } catch (error) {
      const exists = (error as NodeJS.ErrnoException).code === "EEXIST";
      return exists
        ? { path, outcome: "foreign" }
        : { path, outcome: "failed", error: reason(error) };
    }
  }
  // A link, a folder or anything but a plain file is someone else's.
  if (!found.isFile()) return { path, outcome: "foreign" };
  const current = await readFile(path, "utf8").catch(() => null);
  if (current === null || !isOurs(current)) return { path, outcome: "foreign" };
  if (current === text) return { path, outcome: "same" };
  return replaceOurs(path, text);
}

/** The line that puts a folder first on the PATH, with the folder quoted so no character in it runs. */
function putFirst(dir: string, platform: string): string {
  if (platform === "win32") {
    // Not a script: writing the user's Path back as text would freeze its %VARIABLES%.
    return `open "Edit environment variables for your account", select Path, and move ${dir} to the top of the list`;
  }
  return `export PATH='${dir.replaceAll("'", String.raw`'\''`)}':"$PATH"`;
}

const sameFile = (a: string, b: string, platform: string) =>
  platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;

/** The notes for a launcher that setup placed (or found foreign) and the `fd` the PATH finds first. */
export function fdPathNotes(options: {
  launcher: string;
  platform: string;
  outcome: FdLauncherOutcome;
  found: string | null;
  error?: string;
}): string[] {
  const { launcher, platform, outcome, found, error } = options;
  if (outcome === "failed") {
    return [
      `could not write ${launcher} (${error ?? "unknown error"}): the fd command is not installed; "flightdeckd claude" still works. Setup goes on.`,
    ];
  }
  if (outcome === "foreign") {
    return [
      `${launcher} is not Flightdeck's and stays as it is, so the fd command of Flightdeck is not installed. Type "flightdeckd claude" instead, or move that file away and run setup again.`,
    ];
  }
  if (found === null || sameFile(found, launcher, platform)) return [];
  const dir = pathApi(platform).dirname(launcher);
  return [
    `Another "fd" is first on your PATH: ${found}. It runs instead of Flightdeck's ${launcher} until ${dir} comes first.`,
    `To put it first${platform === "win32" ? "" : " (add the line to your shell profile)"}: ${putFirst(dir, platform)}`,
  ];
}

/** What setup does for `fd`: installs the launcher and returns what to tell the person. */
export async function setupFdLauncher(options: {
  stable: string;
  platform: string;
  /** The `fd` the PATH finds first, or null. */
  which: (name: string) => string | null;
}): Promise<string[]> {
  const { stable, platform, which } = options;
  const { path, outcome, error } = await installFdLauncher(stable, platform);
  const notes = fdPathNotes({ launcher: path, platform, outcome, found: which("fd"), error });
  return outcome === "failed" ? notes : [`fd launcher: ${path} (${outcome})`, ...notes];
}
