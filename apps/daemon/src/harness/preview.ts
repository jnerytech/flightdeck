/**
 * Issue #75, slice S3: what adding the chosen harness parts to a project would add, written nowhere.
 * For `.claude/settings.json`, only the entries to append (its text may hold `env` values); a key in
 * the way is reported, never replaced. A Markdown part is a new file, proposed only when missing.
 * See docs/decisions/2026-11-07-harness-preview.md.
 */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, readFile, realpath } from "node:fs/promises";
import {
  type HARNESS_PREVIEW_PARTS,
  type HarnessPreview,
  type HarnessStack,
  HOOK_KINDS,
} from "@flightdeck/protocol";
import { type Walk, walkInside } from "../create-inside.ts";
import { layoutLike, parseJsonText } from "../json-text.ts";
import { detectStack } from "./stack.ts";
import { claudeMd, DENY_RULES, EDIT_MATCHER, reviewerAgent, tddSkill } from "./templates.ts";
import type { TemplateMarkdown } from "./templates-store.ts";

export type PreviewPart = (typeof HARNESS_PREVIEW_PARTS)[number];
type Settings = NonNullable<HarnessPreview["settings"]>;
type Commands = HarnessStack["commands"];

export const SETTINGS = ".claude/settings.json";
/** A formatter hook is recognised as the checklist does, so a preview after an apply adds none. */
const FORMATTER = HOOK_KINDS.find(([kind]) => kind === "format") as (typeof HOOK_KINDS)[number];
export const MAX_FILE = 256 * 1024;

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
 * size, or refused (a link anywhere on the way). See `walkInside`.
 */
export const walk = (root: string, name: string): Promise<Walk> => walkInside(root, name, MAX_FILE);

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

type Additions = Pick<Settings, "hooks" | "denyRules" | "conflicts">;

/** Adds the formatter hook unless one is there; a `hooks` key that cannot take it is a conflict. */
function addFormatterHook(out: Additions, settings: Record<string, unknown>, format: string): void {
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

/** Adds the deny rules not there yet; a `permissions` key that cannot take them is a conflict. */
function addDenyRules(out: Additions, settings: Record<string, unknown>): void {
  const permissions = orEmpty(settings.permissions, {});
  const deny = isObject(permissions) ? orEmpty(permissions.deny, []) : null;
  if (!isObject(permissions)) out.conflicts.push("permissions");
  else if (!Array.isArray(deny)) out.conflicts.push("permissions.deny");
  else out.denyRules = DENY_RULES.filter((rule) => !deny.includes(rule));
}

/**
 * What the settings would gain: the formatter hook, unless one is there, and the deny rules not
 * there yet. A key that holds something other than what can be appended to is a conflict.
 */
function additions(
  settings: Record<string, unknown>,
  parts: readonly PreviewPart[],
  format: string | null,
): Additions {
  const out: Additions = { hooks: [], denyRules: [], conflicts: [] };
  if (parts.includes("hooks") && format !== null) addFormatterHook(out, settings, format);
  if (parts.includes("permissions")) addDenyRules(out, settings);
  return out;
}

/** The settings as they are now: their text (null when there is no file) and parsed object. */
export interface Current {
  text: string | null;
  parsed: Record<string, unknown>;
}

/** The settings proposal, or null when there is nothing to add or report. */
function settingsProposal(
  file: Look,
  parts: readonly PreviewPart[],
  format: string | null,
  unreadable: string[],
): { proposal: Settings; current: Current } | null {
  if (file.state === "refused") {
    unreadable.push(SETTINGS);
    return null;
  }
  let parsed: unknown = {};
  if (file.state === "file") {
    try {
      parsed = parseJsonText(file.text);
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
  /** A held draft to propose instead of the template (#75, G1), by file; null for the template. */
  drafted: (name: string) => string | null = () => null,
  /** A host template's Markdown to propose instead of the fixed files and any draft (#75, T1b). */
  template: TemplateMarkdown | null = null,
): Promise<Plan> {
  const { commands } = await detectStack(root);
  const unreadable: string[] = [];
  const wantsSettings = parts.includes("hooks") || parts.includes("permissions");
  const made = wantsSettings
    ? settingsProposal(await readSettings(root), parts, commands.format, unreadable)
    : null;
  const files: HarnessPreview["files"] = [];
  // A template's files are the Markdown parts, and only they: a part it lacks proposes nothing.
  const markdown: Array<[PreviewPart, string, () => string]> = template
    ? template.files.map((file) => [file.part, file.path, () => file.content])
    : FILES.map(([part, name, make]) => [part, name, () => drafted(name) ?? make(commands)]);
  const wanted = markdown.filter(([part]) => parts.includes(part));
  // Each file is looked at on its own; the answers are used in the order of the list.
  const looks = await Promise.all(wanted.map(([, name]) => look(root, name)));
  for (const [at, [, name, content]] of wanted.entries()) {
    const file = looks[at] as Awaited<ReturnType<typeof look>>;
    if (file.state === "refused") unreadable.push(name);
    else if (file.state === "absent") {
      const text = content();
      files.push({ path: name, content: text, digest: sha256(text) });
    }
  }
  const preview: HarnessPreview = { settings: made?.proposal ?? null, files, unreadable };
  if (template) {
    preview.withheld = template.withheld
      .filter(({ part }) => parts.includes(part))
      .map(({ path, reason }) => ({ path, reason }));
  }
  return { preview, current: made?.current ?? null };
}

/** What adding the chosen parts to the project at `path` would add. Nothing is written or run. */
export async function previewHarness(
  path: string,
  parts: readonly PreviewPart[],
  template: TemplateMarkdown | null = null,
): Promise<HarnessPreview> {
  const root = (await orNull(realpath(path))) ?? path;
  return (await planHarness(root, parts, settingsLook, undefined, template)).preview;
}
