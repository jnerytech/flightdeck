// The reasons a daemon refusal can carry (beside its code), so the app can say it in its language.
// A refusal of the snippet model has its own list (`SNIPPET_REASONS`).

/** Every reason of the daemon outside the snippet model: the app has a text for each, in both languages. */
export const DAEMON_REASONS = [
  "cwd_missing",
  "cwd_outside_roots",
  "session_not_found",
  "session_ended",
  "session_not_ended",
  "personas_off",
  "session_not_running",
  "mcp_set_not_live",
  "mcp_query_not_live",
  "external_no_channel",
  "transcript_not_indexed",
  "session_maybe_active",
  "feature_off",
  "budget_needs_project",
  "budget_not_found",
  "period_inverted",
  "telemetry_confirm",
  "telemetry_owned_keys",
  "telemetry_port",
] as const;
export type DaemonReason = (typeof DAEMON_REASONS)[number];

/** What a reason's text fills in: a path, a session id. */
export type RefusalParams = Record<string, string | number>;

/** Every host feature a command can find off: the app names each one in both languages. */
export const DAEMON_FEATURES = [
  "history",
  "central",
  "vault",
  "names",
  "teams",
  "messaging",
  "idle",
  "actions",
  "automations",
  "issues",
  "autoApprove",
  "agentcfg",
  "mcp",
  "plugins",
  "memory",
  "rewinder",
  "maintenance",
  "usage",
  "quota",
  "costs",
  "budgets",
  "quotaHistory",
  "changes",
  "ssh",
  "snippets",
  "personaSessions",
  "personas",
  "snippetUse",
  "snippetHistory",
  "askpass",
  "sshConnect",
  "sshHostKeys",
  "sshImport",
  "review",
  "files",
  "sessionFiles",
  "terminals",
  "board",
  "snapshots",
  "forker",
  "updater",
  "shutdown",
  "telemetry",
  "trace",
] as const;
export type DaemonFeature = (typeof DAEMON_FEATURES)[number];
