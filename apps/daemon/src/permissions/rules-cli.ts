/**
 * Issue #3457: `flightdeckd rules list|remove` and `flightdeckd autoapprove list|resume`, the permission
 * rules of a project and the automatic approver's decisions from a terminal or a script. They speak to the local
 * daemon like `flightdeckd requests` does. Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import {
  type CliResult,
  type DaemonClient,
  failure,
  json,
  resolveProject,
  runOnLocalDaemon,
  said,
} from "../daemon-client/index.ts";

import {
  autoApproveLines,
  type RulesCliArgs,
  redactedAnswer,
  removedLine,
  ruleLines,
  UNSURE,
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
  const asked = await daemon.call("autoapprove.list", {
    ...(projectId === undefined ? {} : { projectId }),
    ...(args.session === undefined ? {} : { sessionKey: args.session }),
    ...(args.limit === undefined ? {} : { limit: args.limit }),
  });
  // The daemon filters the decisions only; a suspension has no project, so --session is the one narrowing it.
  const answer = redactedAnswer({
    ...asked,
    suspended:
      args.session === undefined
        ? asked.suspended
        : asked.suspended.filter((s) => s.sessionKey === args.session),
  });
  return args.json ? json(answer) : said(...autoApproveLines(answer));
}

async function projectOf(args: RulesCliArgs, daemon: DaemonClient) {
  const { projects } = await daemon.call("project.list", {});
  return resolveProject(projects, args.project);
}

async function removeRule(
  args: RulesCliArgs,
  daemon: DaemonClient,
  note: { wrote: boolean },
): Promise<CliResult> {
  const chosen = await projectOf(args, daemon);
  if ("refusal" in chosen) return chosen.refusal;
  const rule = args.rule ?? "";
  note.wrote = true;
  const { rules } = await daemon.call("rules.remove", {
    projectId: chosen.id,
    rule,
    confirm: args.confirm === true,
  });
  return args.json ? json(rules) : said(removedLine(rule, chosen.name, rules.length));
}

async function resume(
  args: RulesCliArgs,
  daemon: DaemonClient,
  note: { wrote: boolean },
): Promise<CliResult> {
  const sessionKey = args.session ?? "";
  // The daemon answers a resume of a session that is not suspended as done: say it was nothing to do.
  const { suspended } = await daemon.call("autoapprove.list", {});
  if (!suspended.some((s) => s.sessionKey === sessionKey))
    return failure(1, `automatic approval is not suspended for ${sessionKey}`);
  note.wrote = true;
  const left = await daemon.call("autoapprove.resume", {
    sessionKey,
    confirm: args.confirm === true,
  });
  return args.json ? json(left) : said(`automatic approval resumed for ${sessionKey}`);
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
    unsure: UNSURE,
    perform: (daemon, note) => {
      if (args.action === "remove") return removeRule(args, daemon, note);
      if (args.action === "resume") return resume(args, daemon, note);
      return args.noun === "rules" ? listRules(args, daemon) : listDecisions(args, daemon);
    },
  });
}
