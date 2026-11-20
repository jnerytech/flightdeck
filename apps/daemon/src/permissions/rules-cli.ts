/**
 * Issue #3457: `flightdeckd rules list` and `flightdeckd autoapprove list`, the permission rules of a
 * project and the automatic approver's decisions from a terminal or a script. They speak to the local
 * daemon like `flightdeckd requests` does. Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import {
  type CliResult,
  type DaemonClient,
  json,
  resolveProject,
  runOnLocalDaemon,
  said,
} from "../daemon-client/index.ts";

import {
  autoApproveLines,
  type RulesCliArgs,
  redactedAnswer,
  ruleLines,
} from "./domain/rules-cli-view.ts";

const DEFAULT_TIMEOUT_MS = 15_000;

async function listRules(args: RulesCliArgs, daemon: DaemonClient): Promise<CliResult> {
  const { projects } = await daemon.call("project.list", {});
  const chosen = resolveProject(projects, args.project);
  if ("refusal" in chosen) return chosen.refusal;
  const { rules } = await daemon.call("rules.list", { projectId: chosen.id });
  return args.json ? json(rules) : said(...ruleLines(rules, chosen.name));
}

async function listDecisions(args: RulesCliArgs, daemon: DaemonClient): Promise<CliResult> {
  let projectId: string | undefined;
  if (args.project !== undefined) {
    const { projects } = await daemon.call("project.list", {});
    const chosen = resolveProject(projects, args.project);
    if ("refusal" in chosen) return chosen.refusal;
    projectId = chosen.id;
  }
  const answer = redactedAnswer(
    await daemon.call("autoapprove.list", {
      ...(projectId === undefined ? {} : { projectId }),
      ...(args.session === undefined ? {} : { sessionKey: args.session }),
      ...(args.limit === undefined ? {} : { limit: args.limit }),
    }),
  );
  return args.json ? json(answer) : said(...autoApproveLines(answer));
}

export function runRulesCli(
  args: RulesCliArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    clientName: `flightdeck-${args.noun}`,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    perform: (daemon) =>
      args.noun === "rules" ? listRules(args, daemon) : listDecisions(args, daemon),
  });
}
