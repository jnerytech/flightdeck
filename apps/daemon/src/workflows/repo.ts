import { createHash } from "node:crypto";
import { posix } from "node:path";
import { git } from "../board/command.ts";
import { must } from "../board/worktree.ts";

/** Where workflows live in the repository, read from the base branch only. */
export const WORKFLOWS_DIR = ".flightdeck/workflows";

export interface WorkflowSource {
  name: string;
  source: string;
  hash: string;
}

/** Trust is given to this exact content. */
export function hashOf(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

/**
 * The `.yaml` files under `.flightdeck/workflows/` as committed on `base`, by name. Never the
 * card's worktree: a workflow written by the agent on its own branch is never used.
 */
export async function workflowSources(repo: string, base: string): Promise<WorkflowSource[]> {
  const listed = must(
    await git(repo, "ls-tree", "-z", "--name-only", base, "--", `${WORKFLOWS_DIR}/`),
    "git ls-tree",
  );
  const paths = listed.stdout
    .split("\0")
    .filter((path) => path.endsWith(".yaml"))
    .sort();
  const sources: WorkflowSource[] = [];
  for (const path of paths) {
    const { stdout: source } = must(await git(repo, "show", `${base}:${path}`), "git show");
    sources.push({ name: posix.basename(path, ".yaml"), source, hash: hashOf(source) });
  }
  return sources;
}
