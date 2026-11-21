/**
 * Issue #3702: `flightdeckd issues list|get`, a project's tracker issues from a terminal. They change nothing.
 * Exit codes: 0 done, 1 refused (an issue the tracker does not know too), 2 no daemon.
 */
import {
  type CliResult,
  type RemoteTarget,
  resolveProject,
  runOnLocalDaemon,
  shown,
} from "../daemon-client/index.ts";
import { issueLines, listLines } from "./domain/issues-cli-view.ts";

const DEFAULT_TIMEOUT_MS = 30_000;

export type IssuesCliArgs = { project: string; json?: boolean } & (
  | { action: "list"; query?: string }
  | { action: "get"; id: string }
);

export function runIssuesCli(
  args: IssuesCliArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number; remote?: RemoteTarget | undefined } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-issues",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    perform: async (daemon) => {
      const { projects } = await daemon.call("project.list", {});
      const found = resolveProject(projects, args.project);
      if ("refusal" in found) return found.refusal;
      const projectId = found.id;
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
