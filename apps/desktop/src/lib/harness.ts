/**
 * Issue #75, slice S1: a project's Claude Code harness as a checklist, read from what
 * `project.trust.inspect` already lists (#196). Each part is found or missing, with the names or
 * kinds that show it; never a score, and never an `env` value or name.
 */
import type { ProjectLoad } from "@flightdeck/protocol";

export type HarnessPart = "claudeMd" | "hooks" | "skills" | "agents" | "permissions" | "mcp";

/** What a hook command is for, when its command says so. */
export type HookKind = "format" | "gitAdd" | "secrets";

export interface HarnessItem {
  part: HarnessPart;
  found: boolean;
  /** Names (skills, agents, MCP servers), hook kinds, or a count of rules: what shows it. */
  detail: string[];
}

/** Commands that show what a hook is for; anything else is still a hook, of no named kind. */
const KINDS: ReadonlyArray<[HookKind, RegExp]> = [
  ["format", /\b(biome|prettier|eslint --fix|ruff format|black|gofmt|rustfmt|dotnet format)\b/],
  ["gitAdd", /\bgit add\b/],
  ["secrets", /(\.env\b|credentials|secrets?\b|\.pem\b|id_rsa)/],
];

/** The six parts, in the order the card lists them. */
export function harnessParts(load: ProjectLoad): HarnessItem[] {
  const commands = load.hooks.flatMap((hook) => hook.commands);
  const kinds = KINDS.filter(([, pattern]) => commands.some((c) => pattern.test(c))).map(
    ([kind]) => kind,
  );
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
    item(
      "permissions",
      load.allowRules.length > 0,
      load.allowRules.length > 0 ? [String(load.allowRules.length + load.omitted.allowRules)] : [],
    ),
    item(
      "mcp",
      load.mcpServers.length > 0,
      load.mcpServers.map((server) => server.name),
    ),
  ];
}
