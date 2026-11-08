/**
 * Issue #75, slice S1: a project's Claude Code harness as a checklist, read from what
 * `project.trust.inspect` already lists (#196). Each part is found or missing, with the names or
 * kinds that show it; never a score, and never an `env` value or name.
 */
import {
  type HarnessPreview,
  HOOK_KINDS,
  type HookKind,
  type ProjectLoad,
} from "@flightdeck/protocol";

export type HarnessPart = "claudeMd" | "hooks" | "skills" | "agents" | "permissions" | "mcp";

export type { HookKind };

export interface HarnessItem {
  part: HarnessPart;
  found: boolean;
  /** Names (skills, agents, MCP servers), hook kinds, or a count of rules: what shows it. */
  detail: string[];
}

/** The allow and deny counts, or the allow count alone from a host that sends no deny rules. */
function ruleCounts(allow: number, deny: number | null): string[] {
  if (allow + (deny ?? 0) === 0) return [];
  if (deny === null) return [String(allow)];
  return [String(allow), String(deny)];
}

/** The six parts, in the order the card lists them. */
export function harnessParts(load: ProjectLoad): HarnessItem[] {
  const kinds = HOOK_KINDS.filter(([, event, pattern]) =>
    load.hooks.some((hook) => hook.event === event && hook.commands.some((c) => pattern.test(c))),
  ).map(([kind]) => kind);
  const allow = load.allowRules.length + load.omitted.allowRules;
  // A host older than deny rules (#75) sends none: then the count is of allow rules only.
  const deny = load.denyRules ? load.denyRules.length + (load.omitted.denyRules ?? 0) : null;
  const item = (part: HarnessPart, found: boolean, detail: string[] = []): HarnessItem => ({
    part,
    found,
    detail,
  });
  return [
    item("claudeMd", load.claudeMd),
    item("hooks", load.hooks.length > 0, kinds),
    item("skills", load.skills.length > 0, load.skills),
    item("agents", load.agents.length > 0, load.agents),
    item("permissions", allow + (deny ?? 0) > 0, ruleCounts(allow, deny)),
    item(
      "mcp",
      load.mcpServers.length > 0,
      load.mcpServers.map((server) => server.name),
    ),
  ];
}

/**
 * Issue #75, slice S4b: what apply must get back from the preview the person read: each proposal's
 * digest, by path. The app never sends content; the host makes the proposals again and compares.
 */
export function previewDigests(preview: HarnessPreview): Record<string, string> {
  const out: Record<string, string> = {};
  if (preview.settings) out[preview.settings.path] = preview.settings.digest;
  for (const file of preview.files) out[file.path] = file.digest;
  return out;
}

/** The settings gain hooks or deny rules (a conflict alone writes nothing). */
export function writesSettings(preview: HarnessPreview): boolean {
  const settings = preview.settings;
  return settings !== null && settings.hooks.length + settings.denyRules.length > 0;
}

/** Nothing would be written: the setup has nothing to add. */
export function addsNothing(preview: HarnessPreview): boolean {
  return !writesSettings(preview) && preview.files.length === 0;
}

/** Writing the settings back changes their layout: the person ticks that before apply. */
export function needsReformat(preview: HarnessPreview): boolean {
  return writesSettings(preview) && preview.settings?.reformats === true;
}
