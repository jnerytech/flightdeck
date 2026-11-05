/**
 * Phase 39 (ADRs 39-1 and 39-3): the one config document every OpenCode process Flightdeck starts
 * gets through `OPENCODE_CONFIG_CONTENT`, and the environment around it. Flightdeck's own agents are
 * the only ones; everything asks except reads, globs and greps inside the folder; project config is
 * off (`OPENCODE_DISABLE_PROJECT_CONFIG`, verified on 2.2.5, see DECISIONS).
 */

export interface PermissionRule {
  action: string;
  resource: string;
  effect: "allow" | "ask" | "deny";
}

/** The version this phase verified the undocumented switches on. */
export const VERIFIED_OPENCODE_VERSION = "2.2.5";
export const FLIGHTDECK_AGENT = "flightdeck";
export const FLIGHTDECK_PLAN_AGENT = "flightdeck-plan";
/** OpenCode's built-in agents that are not ours, disabled in every process. */
export const BUILT_IN_AGENTS = ["build", "plan", "explore", "general"] as const;

/** Read globs of the credential paths `risk.ts` knows: such a read asks. */
export const CREDENTIAL_READS: readonly string[] = [
  "*/.env*",
  "*.env",
  "*/.ssh/*",
  "*/.aws/*",
  "*/.config/gh/*",
  "*/.claude/.credentials.json",
  "*/.claude.json",
  "*/.flightdeck/config.json",
  "*.pem",
  "*.key",
  "*/id_*",
];

/** The rules of both agents, and the top-level ones. */
export function opencodeRules(): PermissionRule[] {
  return [
    { action: "*", resource: "*", effect: "ask" },
    { action: "read", resource: "*", effect: "allow" },
    { action: "glob", resource: "*", effect: "allow" },
    { action: "grep", resource: "*", effect: "allow" },
    ...CREDENTIAL_READS.map((resource) => ({ action: "read", resource, effect: "ask" as const })),
    { action: "read", resource: "*.env.example", effect: "allow" },
    { action: "question", resource: "*", effect: "deny" },
    { action: "subagent", resource: "*", effect: "deny" },
  ];
}

/** The document, with any extra agent (from the global scope) disabled by id. */
export function opencodeConfig(disabledAgents: readonly string[] = []): Record<string, unknown> {
  const rules = opencodeRules();
  const agents: Record<string, unknown> = {
    [FLIGHTDECK_AGENT]: { mode: "primary", description: "Flightdeck", permissions: rules },
    [FLIGHTDECK_PLAN_AGENT]: {
      mode: "primary",
      description: "Flightdeck plan",
      permissions: [...rules, { action: "edit", resource: "*", effect: "deny" }],
    },
  };
  for (const id of [...BUILT_IN_AGENTS, ...disabledAgents]) {
    if (!(id in agents)) agents[id] = { disabled: true };
  }
  return { default_agent: FLIGHTDECK_AGENT, permissions: rules, agents };
}

/** The session's environment without the daemon's `OPENCODE_*`, plus project config off and ours. */
export function opencodeEnv(
  sessionEnv: Record<string, string>,
  configContent: string,
): Record<string, string> {
  const env = Object.fromEntries(
    Object.entries(sessionEnv).filter(([key]) => !key.toUpperCase().startsWith("OPENCODE_")),
  );
  return { ...env, OPENCODE_DISABLE_PROJECT_CONFIG: "1", OPENCODE_CONFIG_CONTENT: configContent };
}
