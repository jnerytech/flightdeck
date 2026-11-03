import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { type FakeCli, type FakeRule, installFakeCli } from "../../../scripts/test/fake-cli.ts";
import { runGh } from "../src/github/gh.ts";
import { Github } from "../src/github/github.ts";

setDefaultTimeout(20_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

function fakeGh(rules: FakeRule[]): FakeCli {
  const cli = installFakeCli("gh", rules);
  cleanups.push(cli.restore);
  return cli;
}

const SIGNED_IN: FakeRule = {
  args: ["auth", "status"],
  stdout:
    "github.com\n  ✓ Logged in to github.com account octocat (keyring)\n  - Token scopes: 'repo'\n",
};

const ghIssue = (n: number, over: Record<string, unknown> = {}) => ({
  number: n,
  title: `Issue ${n}`,
  body: `body ${n}`,
  url: `https://github.com/acme/app/issues/${n}`,
  author: { login: "ana" },
  labels: [{ name: "bug" }],
  createdAt: "2026-10-01T10:00:00Z",
  authorAssociation: "MEMBER",
  ...over,
});

describe("github-issues: the open issues of one repo", () => {
  test("lists them for that repo from any folder, marking a stranger's as third party", async () => {
    const gh = fakeGh([
      SIGNED_IN,
      { args: ["api", "user"], stdout: "octocat\n" },
      {
        args: ["issue", "list"],
        stdout: JSON.stringify([
          ghIssue(1),
          ghIssue(2, { authorAssociation: "NONE", author: { login: "eve" } }),
        ]),
      },
    ]);
    const issues = await new Github({ gh: runGh }).issues("acme/app");
    expect(issues.map((issue) => [issue.ref, issue.title, issue.external])).toEqual([
      ["github:acme/app#1", "Issue 1", false],
      ["github:acme/app#2", "Issue 2", true],
    ]);
    const list = gh.calls().find((call) => call.includes("list"));
    expect(list).toEqual([
      "issue",
      "list",
      "-R",
      "acme/app",
      "--state",
      "open",
      "--json",
      "number,title,body,url,author,labels,createdAt,authorAssociation",
      "--limit",
      "50",
    ]);
  });

  test("a repo that is not owner/name is refused before gh runs", async () => {
    const gh = fakeGh([SIGNED_IN]);
    const github = new Github({ gh: runGh });
    for (const repo of ["a/..", "", "app", "-R/x", "a/b/c", "a/ b", "../x", "a/b;c", "--web/x"]) {
      await expect(github.issues(repo)).rejects.toMatchObject({ reason: "repo_invalid" });
    }
    expect(gh.calls()).toEqual([]);
  });

  test("a repo gh does not know: repo_not_found", async () => {
    fakeGh([
      SIGNED_IN,
      { args: ["api", "user"], stdout: "octocat\n" },
      {
        args: ["issue", "list"],
        code: 1,
        stderr: "GraphQL: Could not resolve to a Repository with the name 'acme/none'.\n",
      },
    ]);
    await expect(new Github({ gh: runGh }).issues("acme/none")).rejects.toMatchObject({
      reason: "repo_not_found",
    });
  });

  test("signed out: gh_logged_out", async () => {
    fakeGh([
      { args: ["auth", "status"], code: 1, stderr: "You are not logged into any GitHub hosts.\n" },
    ]);
    await expect(new Github({ gh: runGh }).issues("acme/app")).rejects.toMatchObject({
      reason: "gh_logged_out",
    });
  });
});
