/** Issue #3627: the `flightdeckd` nouns whose second word the risk rules read as a verb. */

/**
 * The commands whose second word is a verb the rules read, and not an argument: `fd persona remove`, not `fd send $SID`.
 * One name per line in alphabetical order (a test checks it), so two PRs that add a noun do not conflict (#3759).
 */
export const VERB_NOUNS = new Set([
  "action",
  "agentcfg",
  "approvers",
  "autoapprove",
  "automation",
  "bg",
  "boardsync",
  "budget",
  "card",
  "changes",
  "costs",
  "external",
  "file",
  "history",
  "issues",
  "knowledge",
  "logs",
  "mcp",
  "memory",
  "message",
  "persona",
  "plugins",
  "project",
  "quota",
  "review",
  "rewind",
  "rules",
  "runenv",
  "session",
  "snippet",
  "ssh",
  "team",
  "telemetry",
  "watch",
  "worktree",
]);
