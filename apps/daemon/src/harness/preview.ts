/**
 * Issue #75, slice S3: what adding the chosen harness parts to a project would add, written nowhere.
 * For `.claude/settings.json`, only the entries to append (its text may hold `env` values); a key in
 * the way is reported, never replaced. A Markdown part is a new file, proposed only when missing.
 * See docs/decisions/2026-11-07-harness-preview.md.
 */
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  type HARNESS_PREVIEW_PARTS,
  type HarnessPreview,
  type HarnessStack,
  HOOK_KINDS,
} from "@flightdeck/protocol";
import { isInside } from "../paths.ts";
import { detectStack } from "./stack.ts";
import { claudeMd, DENY_RULES, EDIT_MATCHER, reviewerAgent, tddSkill } from "./templates.ts";

export type PreviewPart = (typeof HARNESS_PREVIEW_PARTS)[number];
type Settings = NonNullable<HarnessPreview["settings"]>;
type Commands = HarnessStack["commands"];

const SETTINGS = ".claude/settings.json";
/** A formatter hook is recognised as the checklist does, so a preview after an apply adds none. */
const FORMATTER = HOOK_KINDS.find(([kind]) => kind === "format") as (typeof HOOK_KINDS)[number];
const MAX_FILE = 256 * 1024;

/** The Markdown parts: each one new file, in the order the preview lists them. */
const FILES: ReadonlyArray<[PreviewPart, string, (commands: Commands) => string]> = [
  ["claudeMd", "CLAUDE.md", claudeMd],
  ["agents", ".claude/agents/reviewer.md", reviewerAgent],
  ["skills", ".claude/skills/tdd/SKILL.md", tddSkill],
];

type Look =
  | { state: "absent" }
  | { state: "refused" }
  | { state: "file"; text: string; hash: string };

const orNull = <T>(promise: Promise<T>): Promise<T | null> =>
  promise.then(
    (value) => value,
    () => null,
  );

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Whether the nearest folder of a path that exists is, for real, inside the project. */
async function parentInside(root: string, dir: string): Promise<boolean> {
  for (let at = dir; ; at = dirname(at)) {
    const real = await orNull(realpath(at));
    if (real !== null) return isInside(root, real);
    if (dirname(at) === at) return false;
  }
}

/**
 * A project file as it is now: missing (with a real place inside the project to create it), a plain
 * file inside the project of a sane size, or refused (a link, a folder, too big, or a way out).
 */
async function look(root: string, name: string): Promise<Look> {
  const full = join(root, name);
  const info = await orNull(lstat(full));
  if (info === null) {
    return (await parentInside(root, dirname(full))) ? { state: "absent" } : { state: "refused" };
  }
  const real = await orNull(realpath(full));
  if (!info.isFile() || info.size > MAX_FILE || real === null || !isInside(root, real)) {
    return { state: "refused" };
  }
  const bytes = await orNull(readFile(real));
  if (bytes === null) return { state: "refused" };
  return {
    state: "file",
    text: bytes.toString("utf8"),
    hash: createHash("sha256").update(bytes).digest("hex"),
  };
}

/** Writing the parsed file back, with its own indent, would change bytes the person wrote. */
function reformats(text: string, parsed: unknown): boolean {
  const indent = /^\{\r?\n([ \t]+)"/.exec(text)?.[1] ?? 2;
  const newline = text.endsWith("\n") ? "\n" : "";
  return `${JSON.stringify(parsed, null, indent)}${newline}` !== text;
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
    const hooks = settings.hooks ?? {};
    const after = isObject(hooks) ? (hooks.PostToolUse ?? []) : null;
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
    const permissions = settings.permissions ?? {};
    const deny = isObject(permissions) ? (permissions.deny ?? []) : null;
    if (!isObject(permissions)) out.conflicts.push("permissions");
    else if (!Array.isArray(deny)) out.conflicts.push("permissions.deny");
    else out.denyRules = DENY_RULES.filter((rule) => !deny.includes(rule));
  }
  return out;
}

/** The settings proposal, or null when there is nothing to add or report. */
async function settingsProposal(
  root: string,
  parts: readonly PreviewPart[],
  format: string | null,
  unreadable: string[],
): Promise<Settings | null> {
  if (!parts.includes("hooks") && !parts.includes("permissions")) return null;
  const file = await look(root, SETTINGS);
  if (file.state === "refused") {
    unreadable.push(SETTINGS);
    return null;
  }
  let parsed: unknown = {};
  if (file.state === "file") {
    try {
      parsed = JSON.parse(file.text);
    } catch {
      parsed = null;
    }
    if (!isObject(parsed)) {
      unreadable.push(SETTINGS);
      return null;
    }
  }
  const added = additions(parsed as Record<string, unknown>, parts, format);
  if (added.hooks.length + added.denyRules.length + added.conflicts.length === 0) return null;
  return {
    path: SETTINGS,
    hash: file.state === "file" ? file.hash : null,
    ...added,
    reformats: file.state === "file" && reformats(file.text, parsed),
  };
}

/** What adding the chosen parts to the project at `path` would add. Nothing is written or run. */
export async function previewHarness(
  path: string,
  parts: readonly PreviewPart[],
): Promise<HarnessPreview> {
  const root = (await orNull(realpath(path))) ?? path;
  const { commands } = await detectStack(root);
  const unreadable: string[] = [];
  const settings = await settingsProposal(root, parts, commands.format, unreadable);
  const files: HarnessPreview["files"] = [];
  for (const [part, name, template] of FILES) {
    if (!parts.includes(part)) continue;
    const file = await look(root, name);
    if (file.state === "refused") unreadable.push(name);
    else if (file.state === "absent") files.push({ path: name, content: template(commands) });
  }
  return { settings, files, unreadable };
}
