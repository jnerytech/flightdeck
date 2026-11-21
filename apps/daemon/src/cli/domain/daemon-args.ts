/**
 * Issue #3780: the daemon's own life from a shell: `flightdeckd update check|apply` and `flightdeckd daemon stop`.
 * They ask the daemon of this machine, never a `--host`. A bare `update --from <binary>` is still the install of a
 * local file (`runUpdateCommand`). The parser in `args.ts` reads the words after the noun here.
 */
import { subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";
import type { Handler } from "./flag-handlers.ts";
import { verbFollows } from "./host-args.ts";

const UPDATE_ACTIONS = ["check", "apply"] as const;
const DAEMON_ACTIONS = ["stop"] as const;

/** `update check|apply`, or `update --from <binary>` with no verb. */
export const updateHandler: Handler = (args, reader) => {
  args.command = "update";
  if (!verbFollows(reader.peek())) return;
  args.action = subAction(reader, UPDATE_ACTIONS, "invalid update action");
};

export const daemonHandler: Handler = (args, reader) => {
  args.command = "daemon";
  args.action = subAction(reader, DAEMON_ACTIONS, "invalid daemon action");
};

/**
 * What is wrong with the flags of these verbs: `apply` and `stop` need `--confirm` (the caller's own word, #3439,
 * but it keeps an unplanned run from starting), and nothing else takes it; the install of a file has no JSON; the
 * two verbs that ask the daemon take neither `--from` nor `--allow-downgrade`.
 */
export function daemonProblem(args: CliArgs): string | undefined {
  const { command, action } = args;
  if (command !== "update" && command !== "daemon") return undefined;
  const confirmed = action === "apply" || action === "stop";
  if (confirmed && args.confirm !== true) return `${command} ${action} needs --confirm`;
  if (!confirmed && args.confirm !== undefined)
    return "--confirm: this flag only applies to flightdeckd update apply and daemon stop";
  if (action === undefined && args.json)
    return "--json: this flag only applies to flightdeckd update check and apply";
  if (action !== undefined && (args.from !== undefined || args.allowDowngrade !== undefined))
    return `--from and --allow-downgrade: these flags only apply to flightdeckd update with no verb, not ${command} ${action}`;
  return undefined;
}
