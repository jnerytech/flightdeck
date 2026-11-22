/**
 * Issue #3703: `flightdeckd github status|repos|issues`, what the host's `gh` is signed in as and the repositories and
 * issues it can see, from a terminal. These only read: nothing here changes the login. Exit codes: 0 done, 1 refused,
 * 2 no daemon.
 */
import {
  type CliResult,
  json,
  type RemoteTarget,
  runOnLocalDaemon,
  said,
} from "../daemon-client/index.ts";
import {
  type GithubCliArgs,
  issueListLines,
  repoLines,
  statusJson,
  statusLines,
} from "./domain/github-cli-view.ts";

const DEFAULT_TIMEOUT_MS = 30_000;

export async function runGithubCli(
  args: GithubCliArgs,
  config: { bind: string; port: number; token: string },
  options: { remote?: RemoteTarget; timeoutMs?: number } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-github",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    perform: async (daemon) => {
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
    },
  });
}
