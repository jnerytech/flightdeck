/**
 * Issue #3702: `flightdeckd issues list|get`, a project's tracker issues from a terminal, and `create-card`, a Backlog
 * card made from one. Only `create-card` changes something. Exit codes: 0 done, 1 refused (an issue the tracker does not
 * know too), 2 no daemon.
 */
import {
  type CliResult,
  json,
  type RemoteTarget,
  resolveProject,
  runOnLocalDaemon,
  said,
  shown,
} from "../daemon-client/index.ts";
import { createdLines, issueLines, listLines } from "./domain/issues-cli-view.ts";

const DEFAULT_TIMEOUT_MS = 30_000;

export type IssuesCliArgs = { project: string; json?: boolean } & (
  | { action: "list"; query?: string }
  | { action: "get"; id: string }
  | { action: "create-card"; issue: string }
);

const UNSURE =
  "; the card may or may not have been created: check with `card list` before trying again";

export function runIssuesCli(
  args: IssuesCliArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number; remote?: RemoteTarget } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-issues",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    ...(args.action === "create-card" ? { unsure: UNSURE } : {}),
    perform: async (daemon, note) => {
      const { projects } = await daemon.call("project.list", {});
      const found = resolveProject(projects, args.project);
      if ("refusal" in found) return found.refusal;
      const projectId = found.id;
      if (args.action === "create-card") {
        note.wrote = true;
        const card = await daemon.call("issues.createCard", { projectId, issueRef: args.issue });
        return args.json ? json(card) : said(...createdLines(card));
      }
      if (args.action === "get")
        return shown(
          args.json,
          await daemon.call("issues.get", { projectId, id: args.id }),
          issueLines,
        );
      const answer = await daemon.call("issues.list", {
        projectId,
        ...(args.query === undefined ? {} : { query: args.query }),
      });
      return shown(args.json, answer, ({ issues }) => listLines(issues));
    },
  });
}
