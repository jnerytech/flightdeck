/**
 * Issue #3703: `flightdeckd github status|repos|issues|login|logout|start`, what the host's `gh` is signed in as and the
 * repositories and issues it can see, and the three things that change something: the sign-in (a one-time code the
 * person types on github.com, never a token here), the sign-out and the start of work on a repository. Exit codes: 0 done,
 * 1 refused, 2 no daemon, and 2 with "may or may not" when a write lost its answer.
 */
import {
  type CliResult,
  type DaemonClient,
  json,
  type RemoteTarget,
  runOnLocalDaemon,
  said,
} from "../daemon-client/index.ts";
import {
  type GithubCliArgs,
  issueListLines,
  loginLines,
  repoLines,
  startLines,
  statusJson,
  statusLines,
} from "./domain/github-cli-view.ts";

const DEFAULT_TIMEOUT_MS = 30_000;
/** `gh auth login` takes a few seconds to print its code; a clone and a first session take far longer. */
const LOGIN_TIMEOUT_MS = 45_000;
const START_TIMEOUT_MS = 330_000;

const TIMEOUTS: Partial<Record<GithubCliArgs["action"], number>> = {
  login: LOGIN_TIMEOUT_MS,
  start: START_TIMEOUT_MS,
};

/** What a write that lost its answer may have done, and how to find out. */
const UNSURE: Partial<Record<GithubCliArgs["action"], string>> = {
  login:
    ": the sign-in may or may not be running; run flightdeckd github login --cancel to end it, or flightdeckd github status to see who is signed in",
  logout:
    ": the host may or may not be signed out; run flightdeckd github status to see who is signed in",
  start:
    ": the clone and the card or session may or may not exist; run flightdeckd project list to look before you run it again",
};

export async function runGithubCli(
  args: GithubCliArgs,
  config: { bind: string; port: number; token: string },
  options: { remote?: RemoteTarget; timeoutMs?: number } = {},
): Promise<CliResult> {
  const unsure = UNSURE[args.action];
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-github",
    timeoutMs: options.timeoutMs ?? TIMEOUTS[args.action] ?? DEFAULT_TIMEOUT_MS,
    ...(unsure === undefined ? {} : { unsure }),
    perform: (daemon, note) =>
      args.action === "login" || args.action === "logout" || args.action === "start"
        ? performWrite(args, daemon, note)
        : performRead(args, daemon),
  });
}

/** `status`, `repos` and `issues` only read. */
async function performRead(args: GithubCliArgs, daemon: DaemonClient): Promise<CliResult> {
  if (args.action === "status") {
    const status = await daemon.call("github.status", {});
    return args.json ? json(statusJson(status)) : said(...statusLines(status));
  }
  if (args.action === "repos") {
    const { repos } = await daemon.call("github.repos", {
      ...(args.query === undefined ? {} : { query: args.query }),
    });
    return args.json ? json({ repos }) : said(...repoLines(repos));
  }
  const { issues } = await daemon.call("github.issues", { repo: args.repo ?? "" });
  return args.json ? json({ issues }) : said(...issueListLines(issues));
}

/** `login`, `logout` and `start` change something: `note.wrote` is set before the write goes out. */
async function performWrite(
  args: GithubCliArgs,
  daemon: DaemonClient,
  note: { wrote: boolean },
): Promise<CliResult> {
  note.wrote = true;
  if (args.action === "login") {
    if (args.cancel) {
      await daemon.call("github.login.cancel", {});
      return args.json ? json({ cancelled: true }) : said("the sign-in was cancelled");
    }
    const login = await daemon.call("github.login.start", {});
    return args.json ? json(login) : said(...loginLines(login));
  }
  if (args.action === "logout") {
    await daemon.call("github.logout", {});
    return args.json ? json({ loggedOut: true }) : said("signed out of GitHub on this host");
  }
  const started = await daemon.call("github.start", {
    repo: args.repo ?? "",
    root: args.root ?? "",
    mode: args.mode ?? "card",
    ...(args.issue === undefined ? {} : { issue: args.issue }),
  });
  return args.json ? json(started) : said(...startLines(started));
}
