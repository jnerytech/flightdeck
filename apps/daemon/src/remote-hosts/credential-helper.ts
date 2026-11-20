/** The credential helper shipped beside the app (issue #3429): where it may be run from, and what it is asked. */
import { lstat } from "node:fs/promises";
import { dirname } from "node:path";
import type { Exec } from "../kernel/index.ts";
import { HOST_ID } from "./domain/rules.ts";

/** What the helper gave for one host: the address, and the token only through a function, so no log or `JSON.stringify` of this object shows it. */
export interface RemoteCredential {
  url: string;
  token: () => string;
}

/** Group- or world-writable: another user could swap what is there. */
const OTHERS_WRITE = 0o022;

interface Owned {
  uid: number;
  mode: number;
}

/** Owned by the user or by root, and not writable by anyone else. */
const trusted = (info: Owned, uid: number) =>
  (info.uid === uid || info.uid === 0) && (info.mode & OTHERS_WRITE) === 0;

/** The first of `candidates` that is a helper this user may run, or null. `uid` is the user running the CLI (null on Windows). */
export async function locateHelper(
  candidates: readonly string[],
  check: { platform: string; uid: number | null },
): Promise<string | null> {
  for (const path of candidates) {
    // `lstat`: a link, to a file or to a folder, is not one.
    const file = await lstat(path).catch(() => null);
    const folder = await lstat(dirname(path)).catch(() => null);
    if (!file?.isFile() || !folder?.isDirectory()) continue;
    // Windows has no owner or mode to check: its install folder is the user's own.
    if (check.platform === "win32" || check.uid === null) return path;
    if (trusted(file, check.uid) && trusted(folder, check.uid)) return path;
  }
  return null;
}

/** A token is a few dozen characters; an address a few hundred. A helper that prints more is not the helper. */
const MAX_OUTPUT = 4096;
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching these characters is the point
const CONTROL = /[\u0000-\u001f\u007f]/;

/** One line the helper printed, or null when it failed or printed anything that is not one plain line. */
async function ask(exec: Exec, helper: string, word: "get" | "url", id: string) {
  const { code, stdout } = await exec([helper, word, "--", id]);
  const line = stdout.trim();
  if (code !== 0 || line === "" || stdout.length > MAX_OUTPUT || CONTROL.test(line)) return null;
  return line;
}

/** The address and the token of host `id`, asked of the helper with a fixed command line, or null for any failure. */
export async function readCredential(
  exec: Exec,
  helper: string,
  id: string,
): Promise<RemoteCredential | null> {
  // The id goes to the helper as an argument: only a UUID does.
  if (!HOST_ID.test(id)) return null;
  try {
    const token = await ask(exec, helper, "get", id);
    const url = token === null ? null : await ask(exec, helper, "url", id);
    return token === null || url === null ? null : { url, token: () => token };
  } catch {
    // A helper that cannot be started says nothing about why: the message may quote its path or output.
    return null;
  }
}

/** The helper runs once per command; a keychain prompt may wait for a person, so this is generous but finite. */
export const HELPER_TIMEOUT_MS = 15_000;
