/**
 * Issue #75, slice S1: a project's Claude Code harness as a checklist, read from what
 * `project.trust.inspect` already lists (#196). Each part is found or missing, with the names or
 * kinds that show it; never a score, and never an `env` value or name.
 */
import { HOOK_KINDS, type HookKind, type ProjectLoad } from "@flightdeck/protocol";

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
