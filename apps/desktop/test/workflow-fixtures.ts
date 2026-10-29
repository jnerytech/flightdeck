import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git } from "../../daemon/test/board-helpers.ts";
import { commitWorkflow, sha256 } from "../../daemon/test/workflow-helpers.ts";
import { daemon as makeDaemon } from "./fixtures.ts";

/**
 * An in-process daemon (listening) whose project repo has each of `workflows` committed on
 * main as `.flightdeck/workflows/<name>.yaml`; the ones in `trusted` are already trusted.
 */
export async function workflowDaemon(
  cleanups: Array<() => unknown>,
  workflows: Record<string, string>,
  trusted: string[] = Object.keys(workflows),
  options: Parameters<typeof makeDaemon>[1] = {},
) {
  const d = makeDaemon(cleanups, options);
  const repo = join(d.root, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "commit.gpgsign", "false");
  writeFileSync(join(repo, "README.md"), "# repo\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "inicial");
  for (const [name, yaml] of Object.entries(workflows)) commitWorkflow(repo, name, yaml);
  const project = await d.board.addProject({ path: repo, promptTemplate: "" });
  for (const name of trusted) {
    await d.board.trustWorkflow(project.id, name, sha256(workflows[name] ?? ""));
  }
  const server = d.listen();
  return { ...d, repo, project, server };
}
