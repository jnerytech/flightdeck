import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type FakeCli, type FakeRule, installFakeCli } from "../../../scripts/test/fake-cli.ts";
import { git } from "../../daemon/test/board-helpers.ts";
import { daemon as makeDaemon } from "./fixtures.ts";

export const GH_REMOTE = "git@github.com:Acme/App.git";

/** An issue as `gh issue list --json` prints it. */
export const ghIssue = (n: number, over: Record<string, unknown> = {}) => ({
  number: n,
  title: `Issue ${n}`,
  body: `corpo ${n}`,
  url: `https://github.com/Acme/App/issues/${n}`,
  author: { login: "ana" },
  labels: [{ name: "auto" }, { name: "bug" }],
  createdAt: "2026-10-01T10:00:00Z",
  authorAssociation: "MEMBER",
  ...over,
});

/** What the fake `gh` answers for these issues. */
export const ghRules = (issues: unknown[]): FakeRule[] => [
  { args: ["api", "user"], stdout: "eu\n" },
  { args: ["issue", "list"], stdout: JSON.stringify(issues) },
  ...issues.map((issue) => ({
    args: ["issue", "view", String((issue as { number: number }).number)],
    stdout: JSON.stringify(issue),
  })),
];

/**
 * An in-process daemon (listening) with a git repository whose origin is GitHub's, a fake `gh` on
 * the PATH answering with `issues`, and the project registered with the issues integration of
 * `config` (none when null).
 */
export async function issuesDaemon(
  cleanups: Array<() => unknown>,
  issues: unknown[],
  config: { provider: "github" | "azure"; query?: string } | null = { provider: "github" },
  features?: string[],
) {
  const d = makeDaemon(cleanups, { issues: true });
  const repo = join(d.root, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "commit.gpgsign", "false");
  writeFileSync(join(repo, "README.md"), "# repo\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "inicial");
  git(repo, "remote", "add", "origin", GH_REMOTE);
  const gh: FakeCli = installFakeCli("gh", ghRules(issues));
  cleanups.push(gh.restore);
  const project = await d.board.addProject({
    path: repo,
    promptTemplate: "",
    ...(config ? { issues: { commentOnPr: false, ...config } } : {}),
  });
  const server = d.listen(0, undefined, features);
  return { ...d, repo, project, server, gh };
}
