/**
 * Issue #75, slice S3: what adding the chosen harness parts to a project would add, written nowhere.
 * For `.claude/settings.json`, only the entries to append (its text may hold `env` values); a key in
 * the way is reported, never replaced. A Markdown part is a new file, proposed only when missing.
 * See docs/decisions/2026-11-07-harness-preview.md.
 */
import { createHash } from "node:crypto";
import { type BigIntStats, constants } from "node:fs";
import { access, lstat, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import {
  type HARNESS_PREVIEW_PARTS,
  type HarnessPreview,
  type HarnessStack,
  HOOK_KINDS,
} from "@flightdeck/protocol";
import { detectStack } from "./stack.ts";
import { claudeMd, DENY_RULES, EDIT_MATCHER, reviewerAgent, tddSkill } from "./templates.ts";

export type PreviewPart = (typeof HARNESS_PREVIEW_PARTS)[number];
type Settings = NonNullable<HarnessPreview["settings"]>;
type Commands = HarnessStack["commands"];

export const SETTINGS = ".claude/settings.json";
/** A formatter hook is recognised as the checklist does, so a preview after an apply adds none. */
const FORMATTER = HOOK_KINDS.find(([kind]) => kind === "format") as (typeof HOOK_KINDS)[number];
export const MAX_FILE = 256 * 1024;
const BOM = "\uFEFF";

/** The Markdown parts: each one new file, in the order the preview lists them. */
const FILES: ReadonlyArray<[PreviewPart, string, (commands: Commands) => string]> = [
  ["claudeMd", "CLAUDE.md", claudeMd],
  ["agents", ".claude/agents/reviewer.md", reviewerAgent],
  ["skills", ".claude/skills/tdd/SKILL.md", tddSkill],
];

export type Look =
  | { state: "absent" }
  | { state: "refused" }
  | { state: "file"; text: string; hash: string };

/** Where a walk ends: missing, refused, or a plain file at `at` whose `lstat` was `info`. */
export type Walk =
  | { state: "absent" }
  | { state: "refused" }
  | { state: "file"; at: string; info: BigIntStats };

const sha256 = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");

export const orNull = <T>(promise: Promise<T>): Promise<T | null> =>
  promise.then(
    (value) => value,
    () => null,
  );

/** A key that is not there is free to fill; one set to anything, null included, is the person's. */
const orEmpty = (value: unknown, empty: object): unknown => (value === undefined ? empty : value);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * A project file as it is now, walked one name at a time from the project's real root: missing (and
 * every folder above it a real folder of the project, where S4 may create it), a plain file of a sane
 * size, or refused. A link anywhere on the way is refused, dangling or not, out of the project or
 * into it: a write must land where the path says.
 */
export async function walk(root: string, name: string): Promise<Walk> {
  let at = root;
  let info: BigIntStats | null = null;
  for (const segment of name.split("/")) {
    // What came before this name must be a folder.
    if (info !== null && !info.isDirectory()) return { state: "refused" };
    at = join(at, segment);
    info = await orNull(lstat(at, { bigint: true }));
    if (info === null) return { state: "absent" };
    if (info.isSymbolicLink()) return { state: "refused" };
  }
  if (!info?.isFile() || info.size > BigInt(MAX_FILE)) return { state: "refused" };
  return { state: "file", at, info };
}

/** A file's bytes as the preview sees them: its text and sha256. */
export const fileLook = (bytes: Buffer): Look => ({
  state: "file",
  text: bytes.toString("utf8"),
  hash: sha256(bytes),
});

async function look(root: string, name: string): Promise<Look> {
  const found = await walk(root, name);
  if (found.state !== "file") return found;
  const bytes = await orNull(readFile(found.at));
  return bytes === null ? { state: "refused" } : fileLook(bytes);
}

/**
 * The settings as apply would find them: a file with a second name (a hard link, which may lie
 * outside the project) or one the host cannot write is refused here too, so the preview never offers
 * what apply would turn down.
 */
async function settingsLook(root: string): Promise<Look> {
  const found = await walk(root, SETTINGS);
  if (found.state !== "file") return found;
  const writable = await access(found.at, constants.W_OK).then(
    () => true,
    () => false,
  );
  if (found.info.nlink !== 1n || !writable) return { state: "refused" };
  return look(root, SETTINGS);
}

/** `value` as JSON laid out like `text` (its indent and final newline); 2 spaces and a newline for a new file. */
export function layoutLike(text: string | null, value: unknown): string {
  if (text === null) return `${JSON.stringify(value, null, 2)}\n`;
  // A UTF-8 byte order mark some Windows editors write: kept, so writing back changes no byte of it.
  const bom = text.startsWith(BOM) ? BOM : "";
  const indent = /^\{\r?\n([ \t]+)"/.exec(text.slice(bom.length))?.[1] ?? 2;
  const newline = text.endsWith("\n") ? "\n" : "";
  return `${bom}${JSON.stringify(value, null, indent)}${newline}`;
}

/** The commands of the hooks already on an event, whatever else their entries hold. */
function commandsOf(entries: unknown[]): string[] {
  return entries.flatMap((entry) =>
    isObject(entry) && Array.isArray(entry.hooks)
      ? entry.hooks.flatMap((hook) =>
          isObject(hook) && typeof hook.command === "string" ? [hook.command] : [],
        )
      : [],
  );
}

/**
 * What the settings would gain: the formatter hook, unless one is there, and the deny rules not
 * there yet. A key that holds something other than what can be appended to is a conflict.
 */
function additions(
  settings: Record<string, unknown>,
  parts: readonly PreviewPart[],
  format: string | null,
): Pick<Settings, "hooks" | "denyRules" | "conflicts"> {
  const out: Pick<Settings, "hooks" | "denyRules" | "conflicts"> = {
    hooks: [],
    denyRules: [],
    conflicts: [],
  };
  if (parts.includes("hooks") && format !== null) {
    const hooks = orEmpty(settings.hooks, {});
    const after = isObject(hooks) ? orEmpty(hooks.PostToolUse, []) : null;
    if (!isObject(hooks)) out.conflicts.push("hooks");
    else if (!Array.isArray(after)) out.conflicts.push("hooks.PostToolUse");
    else {
      const [, event, pattern] = FORMATTER;
      if (!commandsOf(after).some((command) => pattern.test(command))) {
        out.hooks.push({ event, matcher: EDIT_MATCHER, command: format });
      }
    }
  }
  if (parts.includes("permissions")) {
    const permissions = orEmpty(settings.permissions, {});
    const deny = isObject(permissions) ? orEmpty(permissions.deny, []) : null;
    if (!isObject(permissions)) out.conflicts.push("permissions");
    else if (!Array.isArray(deny)) out.conflicts.push("permissions.deny");
    else out.denyRules = DENY_RULES.filter((rule) => !deny.includes(rule));
  }
  return out;
}

/** The settings as they are now: their text (null when there is no file) and parsed object. */
export interface Current {
  text: string | null;
  parsed: Record<string, unknown>;
}

/** The settings proposal, or null when there is nothing to add or report. */
async function settingsProposal(
  file: Look,
  parts: readonly PreviewPart[],
  format: string | null,
  unreadable: string[],
): Promise<{ proposal: Settings; current: Current } | null> {
  if (file.state === "refused") {
    unreadable.push(SETTINGS);
    return null;
  }
  let parsed: unknown = {};
  if (file.state === "file") {
    try {
      parsed = JSON.parse(file.text.startsWith(BOM) ? file.text.slice(BOM.length) : file.text);
    } catch {
      parsed = null;
    }
    if (!isObject(parsed)) {
      unreadable.push(SETTINGS);
      return null;
    }
  }
  const settings = parsed as Record<string, unknown>;
  const added = additions(settings, parts, format);
  if (added.hooks.length + added.denyRules.length + added.conflicts.length === 0) return null;
  const hash = file.state === "file" ? file.hash : null;
  const text = file.state === "file" ? file.text : null;
  return {
    proposal: {
      path: SETTINGS,
      hash,
      ...added,
      reformats: text !== null && layoutLike(text, settings) !== text,
      // The file's hash and every addition: apply refuses when either moved since the preview.
      digest: sha256(JSON.stringify([hash, added.hooks, added.denyRules, added.conflicts])),
    },
    current: { text, parsed: settings },
  };
}

/** What the preview proposes, and the settings it was made from (apply writes from these). */
export interface Plan {
  preview: HarnessPreview;
  current: Current | null;
}

/**
 * The proposals for the project at its real `root`. `readSettings` reads `.claude/settings.json`:
 * the preview reads it plainly, apply from the handle it will write through.
 */
export async function planHarness(
  root: string,
  parts: readonly PreviewPart[],
  readSettings: (root: string) => Promise<Look>,
): Promise<Plan> {
  const { commands } = await detectStack(root);
  const unreadable: string[] = [];
  const wantsSettings = parts.includes("hooks") || parts.includes("permissions");
  const made = wantsSettings
    ? await settingsProposal(await readSettings(root), parts, commands.format, unreadable)
    : null;
  const files: HarnessPreview["files"] = [];
  for (const [part, name, template] of FILES) {
    if (!parts.includes(part)) continue;
    const file = await look(root, name);
    if (file.state === "refused") unreadable.push(name);
    else if (file.state === "absent") {
      const content = template(commands);
      files.push({ path: name, content, digest: sha256(content) });
    }
  }
  return {
    preview: { settings: made?.proposal ?? null, files, unreadable },
    current: made?.current ?? null,
  };
}

/** What adding the chosen parts to the project at `path` would add. Nothing is written or run. */
export async function previewHarness(
  path: string,
  parts: readonly PreviewPart[],
): Promise<HarnessPreview> {
  const root = (await orNull(realpath(path))) ?? path;
  return (await planHarness(root, parts, settingsLook)).preview;
}
