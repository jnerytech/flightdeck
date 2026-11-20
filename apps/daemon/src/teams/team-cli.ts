/**
 * Issue #3455: `flightdeckd team list|show`, the teams of a host from a terminal, a cron job or an
 * agent. It speaks to the local daemon like `flightdeckd card` does (the same `DaemonClient`, the
 * token of the config). Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import { pickProject } from "../board/index.ts";
import {
  type CliResult,
  type DaemonClient,
  json,
  runOnLocalDaemon,
  said,
} from "../daemon-client/index.ts";
import { showLines, type TeamCliArgs, teamLine } from "./domain/team-cli-view.ts";
import { bypassAsked, createdLines, newTeamPayload, UNSURE_NEW } from "./domain/team-new.ts";

export interface TeamCliOptions {
  /** How long the daemon has to answer before the command gives up (exit 2). */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

type Note = { wrote: boolean };

async function listTeams(args: TeamCliArgs, daemon: DaemonClient): Promise<CliResult> {
  const { projects } =
    args.project === undefined ? { projects: [] } : await daemon.call("project.list", {});
  const wanted =
    args.project === undefined ? {} : { projectId: pickProject(projects, args.project).id };
  const { teams } = await daemon.call("teams.list", wanted);
  return args.json ? json(teams) : said(...teams.map(teamLine));
}

/** No identity goes with the request: the daemon answers a person at the terminal as it answers the app. */
async function showTeam(args: TeamCliArgs, daemon: DaemonClient): Promise<CliResult> {
  const status = await daemon.call("teams.status", { team: args.id ?? "" });
  return args.json ? json(status) : said(...showLines(status));
}

/**
 * Creates a team. Its coordinator starts at once; each worker's card starts or waits in the run queue
 * (`createdLines` says which). A member on bypass is the app's second confirm: here it is `--confirm`.
 */
async function newTeam(args: TeamCliArgs, daemon: DaemonClient, note: Note): Promise<CliResult> {
  if (bypassAsked(args) && !args.confirm)
    throw new Error(
      "a member runs in bypassPermissions, which skips every permission prompt: pass --confirm to create the team",
    );
  const { projects } = await daemon.call("project.list", {});
  const payload = newTeamPayload(args, pickProject(projects, args.project).id);
  note.wrote = true;
  const team = await daemon.call("teams.create", payload);
  return args.json ? json(team) : said(...createdLines(team));
}

/** The daemon of this host, with the token of its config: never from the arguments or the environment. */
export function runTeamCli(
  args: TeamCliArgs,
  config: { bind: string; port: number; token: string },
  options: TeamCliOptions = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    clientName: "flightdeck-team",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    perform: (daemon, note) =>
      args.action === "list"
        ? listTeams(args, daemon)
        : args.action === "new"
          ? newTeam(args, daemon, note)
          : showTeam(args, daemon),
    unsure: args.action === "new" ? UNSURE_NEW : undefined,
  });
}
