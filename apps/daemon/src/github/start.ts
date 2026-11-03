/**
 * Phase 36: start from a GitHub project. Clones the repo into an allowed root (or reuses the clone
 * it finds there), registers it as a board project, then opens a card or a session, with the issue
 * quoted when one was picked.
 */
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import type { Issue } from "@flightdeck/protocol";
import type { Board } from "../board/board.ts";
import { git } from "../board/command.ts";
import { FlightdeckError } from "../errors.ts";
import { type Issues, UNTRUSTED_MARK } from "../issues/issues.ts";
import { githubCoords } from "../issues/remote.ts";
import { samePath } from "../paths.ts";
import { allowedRoot, cloneRepo, type GitRunner } from "../project-find.ts";
import type { GhRunner } from "./gh.ts";
import { checkRepo, Github } from "./github.ts";

export interface GithubStartRequest {
  /** `owner/name`. */
  repo: string;
  /** An issue number of that repo. */
  issue?: string;
  /** An allowed root: the clone goes inside it. */
  root: string;
  mode: "card" | "session";
}

export interface GithubStartResult {
  projectId: string;
  path: string;
  cardId?: string;
  sessionId?: string;
  /** True when the folder was already a clone of the repo. */
  reused: boolean;
}

export interface GithubStartDeps {
  gh: GhRunner;
  git: GitRunner;
  roots: readonly string[];
  board: Board;
  issues: Issues;
  startSession(opts: { cwd: string; prompt: string; name: string }): Promise<{ sessionId: string }>;
}

const refuse = (reason: string, message: string, params?: Record<string, string | number>) =>
  new FlightdeckError("invalid_state", message, reason, params);

/** What goes into a session as its first prompt: the issue, under the mark when a stranger wrote it. */
function promptOf(issue: Issue): string {
  return [
    `Work on this GitHub issue (${issue.ref}).`,
    issue.external ? UNTRUSTED_MARK : "",
    `# ${issue.title}`,
    issue.body,
    issue.url,
  ]
    .filter((part) => part.trim() !== "")
    .join("\n\n");
}

/** The folder of the repo inside `root`: a clone of it already there is reused, another repo is refused. */
async function cloneOrReuse(
  repo: string,
  root: string,
  deps: GithubStartDeps,
): Promise<{ path: string; reused: boolean }> {
  const name = repo.split("/")[1] as string;
  const path = join(root, name);
  const present = await lstat(path).then(
    () => true,
    () => false,
  );
  if (!present) {
    await cloneRepo({ url: `https://github.com/${repo}.git`, root, name }, deps.roots, deps.git);
    return { path, reused: false };
  }
  const origin = await git(path, "remote", "get-url", "origin");
  const coords = origin.code === 0 ? githubCoords(origin.stdout.trim()) : null;
  if (coords?.toLowerCase() !== repo.toLowerCase()) {
    throw refuse("clone_exists", `${path} already exists and is not a clone of ${repo}`, { path });
  }
  return { path, reused: true };
}

export async function startFromGithub(
  request: GithubStartRequest,
  deps: GithubStartDeps,
): Promise<GithubStartResult> {
  const { repo, issue: issueId, mode } = request;
  checkRepo(repo);
  if (issueId !== undefined && !/^\d+$/.test(issueId)) {
    throw refuse("issue_invalid", `${issueId} is not an issue number`, { id: issueId });
  }
  const github = new Github({ gh: deps.gh });
  await github.ensureAccess();
  const root = await allowedRoot(request.root, deps.roots);
  // The issue is read before anything is cloned: a number that does not exist costs nothing.
  const issue = issueId === undefined ? null : await github.issue(repo, issueId);
  const { path, reused } = await cloneOrReuse(repo, root, deps);
  const known = deps.board.listProjects().find((project) => samePath(project.path, path));
  const config = { provider: "github" as const, commentOnPr: false };
  const project =
    known ?? (await deps.board.addProject({ path, prProvider: "github", issues: config }));
  if (known && !known.issues) deps.board.updateProject(known.id, { issues: config });
  const result: GithubStartResult = { projectId: project.id, path, reused };
  if (mode === "card") {
    if (issue) {
      const existing = deps.board.cardForIssue(project.id, issue.ref);
      result.cardId = existing ?? (await deps.issues.createCard(project.id, issue.ref)).id;
    }
    return result;
  }
  const started = await deps.startSession({
    cwd: path,
    prompt: issue ? promptOf(issue) : `Look at ${repo} and wait for my instructions.`,
    name: issue ? issue.title : (repo.split("/")[1] as string),
  });
  return { ...result, sessionId: started.sessionId };
}
