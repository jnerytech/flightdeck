/** Which commands take `--json` and `--host` (#1589 split of `args.ts`), and the refusal of one on any other. */
import { USAGE } from "./usage.ts";

/**
 * The commands that take `--json` and `--host`; a flag on any other is refused with this list. This list and the
 * two below are one name per line in alphabetical order (a test checks it), so a PR that adds a command and one
 * that adds another do not conflict (#3759).
 */
export const JSON_COMMANDS = [
  "action",
  "activity",
  "agentcfg",
  "alert",
  "approve",
  "approvers",
  "autoapprove",
  "automation",
  "bg",
  "board",
  "boardsync",
  "budget",
  "card",
  "changes",
  "costs",
  "deny",
  "file",
  "history",
  "host",
  "knowledge",
  "logs",
  "mcp",
  "memory",
  "message",
  "persona",
  "plugins",
  "project",
  "quota",
  "releases",
  "requests",
  "review",
  "rewind",
  "roi",
  "rules",
  "runenv",
  "send",
  "session",
  "sessions",
  "snapshots",
  "snippet",
  "ssh",
  "team",
  "terminal",
  "trace",
  "usage",
  "vault",
  "watch",
  "workflow",
];
export const HOST_COMMANDS = [
  "action",
  "activity",
  "agentcfg",
  "alert",
  "approve",
  "automation",
  "bg",
  "boardsync",
  "changes",
  "deny",
  "file",
  "host",
  "knowledge",
  "logs",
  "mcp",
  "memory",
  "message",
  "plugins",
  "project",
  "releases",
  "requests",
  "review",
  "rewind",
  "runenv",
  "send",
  "session",
  "sessions",
  "snapshots",
  "snippet",
  "ssh",
  "terminal",
  "trace",
  "vault",
  "watch",
  "workflow",
];

/** The commands that take `--limit`; a flag on any other is refused. */
export const LIMIT_COMMANDS: readonly string[] =
  "autoapprove history vault snippet message automation action releases activity".split(" ");

/** The commands that check their own `--confirm` (their verbs say which take it), so the `card` check skips them. */
export const CONFIRM_OWNERS = [
  "agentcfg",
  "autoapprove",
  "automation",
  "boardsync",
  "costs",
  "mcp",
  "memory",
  "message",
  "plugins",
  "project",
  "review",
  "rewind",
  "rules",
  "runenv",
  "snippet",
  "ssh",
  "team",
];

export function refuseOutside(flag: string, commands: readonly string[], command: string): void {
  if (commands.includes(command)) return;
  const list = `${commands.slice(0, -1).join(", ")} and ${commands.at(-1)}`;
  throw new Error(`${flag}: this flag only applies to flightdeckd ${list}\n${USAGE}`);
}
