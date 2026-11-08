/**
 * Issue #75, slice S4: writes what the harness preview proposed. The proposals are made again here,
 * from the files as they are now, never taken from the app; the app's digests must match every one
 * of them. Settings gain entries and lose nothing. See docs/decisions/2026-11-07-harness-apply.md.
 */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { type FileHandle, open, realpath } from "node:fs/promises";
import type { HarnessApplied, HarnessPreview } from "@flightdeck/protocol";
import { createInside } from "../create-inside.ts";
import { FlightdeckError } from "../errors.ts";
import { layoutLike } from "../json-text.ts";
import { samePath } from "../paths.ts";
import type { HarnessDrafts } from "./draft.ts";
import {
  type Current,
  fileLook,
  type Look,
  MAX_FILE,
  orNull,
  type PreviewPart,
  planHarness,
  SETTINGS,
  walk,
} from "./preview.ts";

type Settings = NonNullable<HarnessPreview["settings"]>;

const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

/** Not defined on Windows: there the walk and the handle's identity check stand alone. */
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;

/** How apply opens the settings file: a seam for a test that swaps the file in between. */
export interface ApplyFs {
  open(path: string, flags: number): Promise<FileHandle>;
}
export interface ApplyOptions {
  /** The person accepted that writing the settings back changes their layout (`reformats`). */
  reformat?: boolean;
  fs?: ApplyFs;
  /** The drafts the host holds (#75, G1): a file whose digest is a held draft's is that draft. */
  drafts?: Pick<HarnessDrafts, "held">;
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

/** A new file at `name`, which must still be missing; anything else is a project that changed. */
async function create(root: string, name: string, content: string, fs: ApplyFs): Promise<void> {
  if (!(await createInside(root, name, content, fs.open))) throw stale();
}

async function writeSettings(
  root: string,
  handle: FileHandle | null,
  current: Current,
  settings: Settings,
  fs: ApplyFs,
): Promise<string> {
  const text = layoutLike(current.text, merged(current.parsed, settings));
  if (handle === null) {
    await create(root, SETTINGS, text, fs);
    return text;
  }
  // Written over the old bytes, then cut to length: never truncated first, so a write that fails
  // leaves something to put back, and the person's bytes (their env included) are put back.
  const bytes = Buffer.from(text, "utf8");
  const before = Buffer.from(current.text ?? "", "utf8");
  try {
    const { bytesWritten } = await handle.write(bytes, 0, bytes.length, 0);
    if (bytesWritten !== bytes.length) throw new Error("settings write was cut short");
    await handle.truncate(bytes.length);
  } catch (error) {
    await handle.write(before, 0, before.length, 0);
    await handle.truncate(before.length);
    throw error;
  }
  return text;
}

/** Writes the chosen parts into the project at `path`, when `digests` match the proposals now. */
export async function applyHarness(
  path: string,
  parts: readonly PreviewPart[],
  digests: Readonly<Record<string, string>>,
  options: ApplyOptions = {},
): Promise<HarnessApplied> {
  const fs = options.fs ?? diskFs;
  // `path` is real (the server resolved it inside the allowed roots): it must still be.
  if (!samePath((await orNull(realpath(path))) ?? "", path)) throw stale();
  const root = path;
  let handle: FileHandle | null = null;
  try {
    const drafted = (name: string) => {
      const digest = digests[name];
      return digest && options.drafts ? options.drafts.held(root, name, digest) : null;
    };
    const plan = await planHarness(
      root,
      parts,
      async (at) => {
        const opened = await openSettings(at, fs);
        handle = opened.handle;
        return opened.look;
      },
      drafted,
    );
    // Everything is checked before anything is written.
    if (!sameDigests(digestsOf(plan.preview), digests)) throw stale();
    const { settings, files } = plan.preview;
    const writesSettings =
      settings !== null && settings.hooks.length + settings.denyRules.length > 0;
    // A JSON round trip may also change values (big numbers, escapes, a repeated key): the person
    // saw `reformats` in the preview and says yes to it, or the settings are not written.
    if (writesSettings && settings?.reformats && options.reformat !== true) {
      throw new FlightdeckError(
        "invalid_state",
        "writing the settings back would change their layout: confirm with reformat: true",
        "harness_reformat",
      );
    }
    // New files first: one that appeared since the check refuses before the settings change.
    for (const file of files) await create(root, file.path, file.content, fs); // NOSONAR: in order: a file that appeared since the check refuses before the next is written
    const written = files.map((file) => file.path);
    // What each file holds now, as written: a commit of the setup (C1) takes exactly these.
    const wrote: Record<string, string> = Object.fromEntries(
      files.map((file) => [file.path, sha256(file.content)]),
    );
    if (writesSettings && settings && plan.current) {
      wrote[SETTINGS] = sha256(await writeSettings(root, handle, plan.current, settings, fs));
      written.unshift(SETTINGS);
    }
    return { written, digests: wrote };
  } finally {
    await (handle as FileHandle | null)?.close();
  }
}
