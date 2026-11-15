/**
 * What adding the chosen harness parts to a project's `.claude/settings.json` would add (#75, S3): the
 * formatter hook unless one is there, and the deny rules not there yet, as a proposal over the file as
 * it is now. A key that cannot take an append is a conflict, never replaced. Pure: the file is read by
 * the preview and apply, which pass it in as a `Look`.
 */
import { createHash } from "node:crypto";
import { type HARNESS_PREVIEW_PARTS, type HarnessPreview, HOOK_KINDS } from "@flightdeck/protocol";
import { layoutLike, parseJsonText } from "../../kernel/index.ts";
import { DENY_RULES, EDIT_MATCHER } from "./templates.ts";

export type PreviewPart = (typeof HARNESS_PREVIEW_PARTS)[number];
type Settings = NonNullable<HarnessPreview["settings"]>;

export const SETTINGS = ".claude/settings.json";
/** A formatter hook is recognised as the checklist does, so a preview after an apply adds none. */
const FORMATTER = HOOK_KINDS.find(([kind]) => kind === "format") as (typeof HOOK_KINDS)[number];

export type Look =
  | { state: "absent" }
  | { state: "refused" }
  | { state: "file"; text: string; hash: string };

export const sha256 = (data: string | Buffer): string =>
  createHash("sha256").update(data).digest("hex");

/** A key that is not there is free to fill; one set to anything, null included, is the person's. */
const orEmpty = (value: unknown, empty: object): unknown => (value === undefined ? empty : value);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

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
export function settingsProposal(
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
