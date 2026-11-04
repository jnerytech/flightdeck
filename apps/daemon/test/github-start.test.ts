import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type FakeCli, type FakeRule, installFakeCli } from "../../../scripts/test/fake-cli.ts";
import { runGh } from "../src/github/gh.ts";
import { GithubService } from "../src/github/service.ts";
import { type GithubStartRequest, startFromGithub } from "../src/github/start.ts";
import { Issues, UNTRUSTED_MARK } from "../src/issues/issues.ts";
import type { GitRunner } from "../src/project-find.ts";
import { git, newBoard } from "./board-helpers.ts";

setDefaultTimeout(30_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const SIGNED_IN: FakeRule = {
  args: ["auth", "status"],
  stdout:
    "github.com\n  ✓ Logged in to github.com account octocat (keyring)\n  - Token scopes: 'repo', 'read:project'\n",
};

const ghIssue = (n: number, over: Record<string, unknown> = {}) => ({
  number: n,
  title: `Fix the login ${n}`,
  body: `The login breaks, case ${n}`,
  url: `https://github.com/acme/app/issues/${n}`,
  author: { login: "ana" },
  labels: [{ name: "bug" }],
  createdAt: "2026-10-01T10:00:00Z",
  authorAssociation: "MEMBER",
  ...over,
});

function fakeGh(rules: FakeRule[]): FakeCli {
  const cli = installFakeCli("gh", [
    SIGNED_IN,
    { args: ["api", "user"], stdout: "octocat\n" },
    ...rules,
  ]);
  cleanups.push(cli.restore);
  return cli;
}

const issueRules = (...issues: Array<ReturnType<typeof ghIssue>>): FakeRule[] =>
  issues.map((issue) => ({
    args: ["issue", "view", String(issue.number)],
    stdout: JSON.stringify(issue),
  }));

/** A clone that never reaches the network: a repository with one commit and the https origin. */
function setup() {
  const ctx = newBoard();
  cleanups.push(() => ctx.board.stop());
  const clones: string[][] = [];
  const cloner: GitRunner = async (args) => {
    clones.push(args);
    const [, , url, dest] = args as [string, string, string, string];
    mkdirSync(dest, { recursive: true });
    git(dest, "init", "-q", "-b", "main");
    git(dest, "config", "commit.gpgsign", "false");
    writeFileSync(join(dest, "README.md"), "# app\n");
    git(dest, "add", ".");
    git(dest, "commit", "-q", "-m", "first");
    git(dest, "remote", "add", "origin", url);
    return { code: 0, stderr: "" };
  };
  const suspended: string[] = [];
  const issues = new Issues({
    board: ctx.board,
    autoApprove: { suspend: (key) => suspended.push(key) },
  });
  const sessions: Array<{ cwd: string; prompt: string; name: string }> = [];
  const start = (request: Partial<GithubStartRequest> = {}, roots = [ctx.root]) =>
    startFromGithub(
      { repo: "acme/app", root: ctx.root, mode: "card", ...request },
      {
        gh: runGh,
        git: cloner,
        roots,
        board: ctx.board,
        issues,
        startSession: async (opts) => {
          sessions.push(opts);
          return { sessionId: `s-${sessions.length}` };
        },
      },
    );
  return { ...ctx, clones, suspended, sessions, start, cloner, issues };
}

describe("github-start: a repo or an issue becomes a project, a card or a session", () => {
  test("the service starts a session through the host's own session starter", async () => {
    fakeGh([]);
    const s = setup();
    const started: string[] = [];
    const service = new GithubService({
      roots: [s.root],
      board: s.board,
      issues: s.issues,
      git: s.cloner,
      startSession: async (session) => {
        started.push(session.cwd);
        return { sessionId: "s-9" };
      },
    });
    const result = await service.start({ repo: "acme/app", root: s.root, mode: "session" });
    expect(result.sessionId).toBe("s-9");
    expect(started).toEqual([join(s.root, "app")]);
  });

  test("clones into the root and registers the project with the GitHub issue integration", async () => {
    fakeGh([]);
    const s = setup();
    const result = await s.start();
    expect(result).toMatchObject({ path: join(s.root, "app"), reused: false });
    expect(s.clones).toEqual([
      ["clone", "--", "https://github.com/acme/app.git", join(s.root, "app")],
    ]);
    const project = s.board.getProject(result.projectId);
    expect(project).toMatchObject({ path: join(s.root, "app"), issues: { provider: "github" } });
    expect(result.cardId).toBeUndefined();
  });

  test("a second start reuses the clone and the project, and clones nothing", async () => {
    fakeGh([]);
    const s = setup();
    const first = await s.start();
    const second = await s.start();
    expect(second).toMatchObject({ projectId: first.projectId, path: first.path, reused: true });
    expect(s.clones).toHaveLength(1);
  });

  test("a folder with that name that is another repo is refused, and nothing is registered", async () => {
    fakeGh([]);
    const s = setup();
    const other = join(s.root, "app");
    mkdirSync(other);
    git(other, "init", "-q", "-b", "main");
    git(other, "remote", "add", "origin", "https://github.com/someone/else.git");
    await expect(s.start()).rejects.toMatchObject({ reason: "clone_exists" });
    expect(s.board.listProjects().filter((p) => p.path === other)).toEqual([]);
  });

  test("a root outside the allowed ones is refused before anything runs", async () => {
    const gh = fakeGh([]);
    const s = setup();
    await expect(s.start({ root: "/tmp" })).rejects.toMatchObject({ reason: "cwd_outside_roots" });
    expect(s.clones).toEqual([]);
    expect(gh.calls().some((call) => call.includes("clone"))).toBe(false);
  });

  test("a card from an issue carries its title, body and link, once per issue", async () => {
    fakeGh(issueRules(ghIssue(7)));
    const s = setup();
    const result = await s.start({ issue: "7" });
    const card = s.board.getCard(result.cardId as string);
    expect(card).toMatchObject({ title: "Fix the login 7", issueRef: "github:acme/app#7" });
    expect(card.description).toContain("The login breaks, case 7");
    expect(card.description).toContain("https://github.com/acme/app/issues/7");
    const again = await s.start({ issue: "7" });
    expect(again.cardId).toBe(result.cardId);
  });

  test("an issue from a stranger carries the third-party mark and gets no automatic approval", async () => {
    fakeGh(issueRules(ghIssue(8, { author: { login: "eve" }, authorAssociation: "NONE" })));
    const s = setup();
    const result = await s.start({ issue: "8" });
    expect(s.board.getCard(result.cardId as string).description).toContain(UNTRUSTED_MARK);
    expect(s.suspended).toEqual([`card:${result.cardId}`]);
  });

  test("a session starts in the folder, and its first prompt quotes the issue", async () => {
    fakeGh(issueRules(ghIssue(7)));
    const s = setup();
    const result = await s.start({ issue: "7", mode: "session" });
    expect(result.sessionId).toBe("s-1");
    expect(result.cardId).toBeUndefined();
    expect(s.sessions).toHaveLength(1);
    expect(s.sessions[0]).toMatchObject({ cwd: join(s.root, "app"), name: "Fix the login 7" });
    expect(s.sessions[0]?.prompt).toContain("Fix the login 7");
    expect(s.sessions[0]?.prompt).toContain("The login breaks, case 7");
    expect(s.sessions[0]?.prompt).toContain("https://github.com/acme/app/issues/7");
    expect(s.sessions[0]?.prompt).not.toContain(UNTRUSTED_MARK);
  });

  test("a stranger's issue goes into the session prompt under the third-party mark", async () => {
    fakeGh(issueRules(ghIssue(8, { author: { login: "eve" }, authorAssociation: "NONE" })));
    const s = setup();
    await s.start({ issue: "8", mode: "session" });
    expect(s.sessions[0]?.prompt).toContain(UNTRUSTED_MARK);
  });

  test("a session without an issue still has a first prompt, named after the repo", async () => {
    fakeGh([]);
    const s = setup();
    await s.start({ mode: "session" });
    expect(s.sessions[0]?.name).toBe("app");
    expect(s.sessions[0]?.prompt.length).toBeGreaterThan(0);
  });

  test("an issue that does not exist: issue_not_found, and nothing is cloned", async () => {
    fakeGh([
      {
        args: ["issue", "view"],
        code: 1,
        stderr: "GraphQL: Could not resolve to an issue or pull request with the number of 99.\n",
      },
    ]);
    const s = setup();
    await expect(s.start({ issue: "99" })).rejects.toMatchObject({ reason: "issue_not_found" });
    expect(s.clones).toEqual([]);
  });

  test("a bad repo or issue is refused before gh or git run", async () => {
    const gh = fakeGh([]);
    const s = setup();
    await expect(s.start({ repo: "-R/x" })).rejects.toMatchObject({ reason: "repo_invalid" });
    await expect(s.start({ issue: "7; rm" })).rejects.toMatchObject({ reason: "issue_invalid" });
    await expect(s.start({ issue: "-1" })).rejects.toMatchObject({ reason: "issue_invalid" });
    expect(gh.calls()).toEqual([]);
    expect(s.clones).toEqual([]);
  });

  test("signed out: gh_logged_out, before any clone", async () => {
    const cli = installFakeCli("gh", [
      { args: ["auth", "status"], code: 1, stderr: "You are not logged into any GitHub hosts.\n" },
    ]);
    cleanups.push(cli.restore);
    const s = setup();
    await expect(s.start()).rejects.toMatchObject({ reason: "gh_logged_out" });
    expect(s.clones).toEqual([]);
  });
});
