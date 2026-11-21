/** Which commands take `--json` and `--host` (#1589 split of `args.ts`), and the refusal of one on any other. */
import { USAGE } from "./usage.ts";

/** The commands that take `--json` and `--host`; a flag on any other is refused with this list. */
export const JSON_COMMANDS =
  "card board history team persona quota usage budget costs roi host sessions session snippet ssh terminal watch boardsync review memory worktree issues runenv changes file action automation mcp knowledge requests send approve deny approvers rules autoapprove vault plugins project agentcfg message".split(
    " ",
  );
export const HOST_COMMANDS =
  "host sessions session snippet ssh terminal watch boardsync review memory worktree issues runenv changes file action automation mcp knowledge requests send approve deny vault plugins project agentcfg message".split(
    " ",
  );

/** The commands that check their own `--confirm` (their verbs say which take it), so the `card` check skips them. */
export const CONFIRM_OWNERS =
  "rules autoapprove team costs plugins ssh project boardsync runenv automation agentcfg snippet review mcp message memory".split(
    " ",
  );

export function refuseOutside(flag: string, commands: readonly string[], command: string): void {
  if (commands.includes(command)) return;
  const list = `${commands.slice(0, -1).join(", ")} and ${commands.at(-1)}`;
  throw new Error(`${flag}: this flag only applies to flightdeckd ${list}\n${USAGE}`);
}
