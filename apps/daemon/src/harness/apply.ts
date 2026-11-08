/**
 * Issue #75, slice S4: writes what the harness preview proposed. The proposals are made again here,
 * from the files as they are now, never taken from the app; the app's digests must match every one
 * of them. Settings gain entries and lose nothing. See docs/decisions/2026-11-07-harness-apply.md.
 */
import { constants } from "node:fs";
import { type FileHandle, lstat, mkdir, open, realpath } from "node:fs/promises";
import { join } from "node:path";
import type { HarnessApplied, HarnessPreview } from "@flightdeck/protocol";
import { FlightdeckError } from "../errors.ts";
import {
  type Current,
  fileLook,
  type Look,
  layoutLike,
  MAX_FILE,
  orNull,
  type PreviewPart,
  planHarness,
  SETTINGS,
  walk,
} from "./preview.ts";

type Settings = NonNullable<HarnessPreview["settings"]>;

/** Not defined on Windows: there the walk and the handle's identity check stand alone. */
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;

/** How apply opens the settings file: a seam for a test that swaps the file in between. */
export interface ApplyFs {
  open(path: string, flags: number): Promise<FileHandle>;
}
const diskFs: ApplyFs = { open: (path, flags) => open(path, flags) };

const stale = () =>
  new FlightdeckError(
    "invalid_state",
    "the project changed since the preview: preview again",
    "harness_stale",
  );

/** Each proposal's digest, by path: what the app had to send back. */
function digestsOf(preview: HarnessPreview): Map<string, string> {
  const out = new Map<string, string>();
  if (preview.settings) out.set(preview.settings.path, preview.settings.digest);
  for (const file of preview.files) out.set(file.path, file.digest);
  return out;
}

function sameDigests(now: Map<string, string>, sent: Readonly<Record<string, string>>): boolean {
  const keys = Object.keys(sent);
  return keys.length === now.size && keys.every((key) => now.get(key) === sent[key]);
}

/**
 * Opens the settings for writing, after a fresh walk with no link on it: through a handle that does
 * not follow a link, and that must be the very file the walk found. The bytes hashed are the bytes
 * of that handle, so what is checked is what is written.
 */
async function openSettings(
  root: string,
  fs: ApplyFs,
): Promise<{ look: Look; handle: FileHandle | null }> {
  const found = await walk(root, SETTINGS);
  if (found.state !== "file") return { look: found, handle: null };
  const handle = await orNull(fs.open(found.at, constants.O_RDWR | NO_FOLLOW));
  if (handle === null) return { look: { state: "refused" }, handle: null };
  // As bigints: a Windows file index can pass 2^53, where numbers would round two files together.
  const info = await handle.stat({ bigint: true });
  const same = info.dev === found.info.dev && info.ino === found.info.ino;
  // A second name for the file (a hard link) may lie outside the project: writing would change it there.
  if (!same || info.nlink !== 1n || !info.isFile() || info.size > BigInt(MAX_FILE)) {
    await handle.close();
    return { look: { state: "refused" }, handle: null };
  }
  return { look: fileLook(await handle.readFile()), handle };
}

/** The settings with the additions appended: no key already there is changed or removed. */
function merged(current: Record<string, unknown>, settings: Settings): Record<string, unknown> {
  const out = { ...current };
  if (settings.hooks.length > 0) {
    // The preview proposes hooks only where `hooks` and each event are free or lists.
    const hooks = { ...((out.hooks as Record<string, unknown[]> | undefined) ?? {}) };
    for (const hook of settings.hooks) {
      hooks[hook.event] = [
        ...(hooks[hook.event] ?? []),
        { matcher: hook.matcher, hooks: [{ type: "command", command: hook.command }] },
      ];
    }
    out.hooks = hooks;
  }
  if (settings.denyRules.length > 0) {
    const permissions = { ...((out.permissions as Record<string, unknown> | undefined) ?? {}) };
    permissions.deny = [
      ...((permissions.deny as unknown[] | undefined) ?? []),
      ...settings.denyRules,
    ];
    out.permissions = permissions;
  }
  return out;
}

/**
 * Creates a new file at `name`, which must still be missing: each folder on the way is made or
 * found as a real folder (a link there is refused), and the file is opened only if it does not exist.
 */
async function create(root: string, name: string, content: string, fs: ApplyFs): Promise<void> {
  const names = name.split("/");
  let at = root;
  for (const segment of names.slice(0, -1)) {
    at = join(at, segment);
    await orNull(mkdir(at));
    const info = await orNull(lstat(at));
    if (info === null || !info.isDirectory()) throw stale();
  }
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NO_FOLLOW;
  const handle = await orNull(fs.open(join(at, names.at(-1) as string), flags));
  if (handle === null) throw stale();
  try {
    // A folder on the way swapped for a link since the loop: the new file is not where the path says.
    // It is still empty, and was made by this call (O_EXCL), so nothing of the person's is touched.
    if ((await orNull(realpath(at))) !== at) throw stale();
    await handle.writeFile(content);
  } finally {
    await handle.close();
  }
}

async function writeSettings(
  root: string,
  handle: FileHandle | null,
  current: Current,
  settings: Settings,
  fs: ApplyFs,
): Promise<void> {
  const text = layoutLike(current.text, merged(current.parsed, settings));
  if (handle === null) return create(root, SETTINGS, text, fs);
  await handle.truncate(0);
  await handle.write(text, 0, "utf8");
}

/** Writes the chosen parts into the project at `path`, when `digests` match the proposals now. */
export async function applyHarness(
  path: string,
  parts: readonly PreviewPart[],
  digests: Readonly<Record<string, string>>,
  fs: ApplyFs = diskFs,
): Promise<HarnessApplied> {
  // `path` is real (the server resolved it inside the allowed roots): it must still be.
  if ((await orNull(realpath(path))) !== path) throw stale();
  const root = path;
  let handle: FileHandle | null = null;
  try {
    const plan = await planHarness(root, parts, async (at) => {
      const opened = await openSettings(at, fs);
      handle = opened.handle;
      return opened.look;
    });
    // Everything is checked before anything is written.
    if (!sameDigests(digestsOf(plan.preview), digests)) throw stale();
    const { settings, files } = plan.preview;
    // New files first: one that appeared since the check refuses before the settings change.
    for (const file of files) await create(root, file.path, file.content, fs);
    const written = files.map((file) => file.path);
    if (settings && plan.current && settings.hooks.length + settings.denyRules.length > 0) {
      await writeSettings(root, handle, plan.current, settings, fs);
      written.unshift(SETTINGS);
    }
    return { written };
  } finally {
    await (handle as FileHandle | null)?.close();
  }
}
