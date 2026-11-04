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
    "github.com\n  ✓ Logged in to github.com account octocat (keyring)\n  - Token scopes: 'repo', 'read:project'\n",
};

const own = (n: number) => ({
  nameWithOwner: `octocat/repo-${n}`,
  description: n % 2 ? null : `repo ${n}`,
  isPrivate: n % 2 === 1,
  url: `https://github.com/octocat/repo-${n}`,
  updatedAt: "2026-10-01T10:00:00Z",
});

describe("github-repos: a person's repos and a search", () => {
  test("lists the person's repos, newest first as gh gives them, in the app's shape", async () => {
    const gh = fakeGh([
      SIGNED_IN,
      { args: ["repo", "list"], stdout: JSON.stringify([own(1), own(2)]) },
    ]);
    expect(await new Github({ gh: runGh }).repos()).toEqual([
      {
        name: "octocat/repo-1",
        description: "",
        private: true,
        url: "https://github.com/octocat/repo-1",
        updatedAt: "2026-10-01T10:00:00Z",
      },
      {
        name: "octocat/repo-2",
        description: "repo 2",
        private: false,
        url: "https://github.com/octocat/repo-2",
        updatedAt: "2026-10-01T10:00:00Z",
      },
    ]);
    expect(gh.calls()[1]).toEqual([
      "repo",
      "list",
      "--json",
      "nameWithOwner,description,isPrivate,url,updatedAt",
      "--limit",
      "50",
    ]);
  });

  test("a query searches, and goes as one argument after --, so it never reads as a flag", async () => {
    const gh = fakeGh([
      SIGNED_IN,
      {
        args: ["search", "repos"],
        stdout: JSON.stringify([
          {
            fullName: "acme/app",
            description: "an app",
            isPrivate: false,
            url: "https://github.com/acme/app",
            updatedAt: "2026-10-02T10:00:00Z",
          },
        ]),
      },
    ]);
    const repos = await new Github({ gh: runGh }).repos("--web flightdeck");
    expect(repos.map((repo) => repo.name)).toEqual(["acme/app"]);
    expect(gh.calls()[1]).toEqual([
      "search",
      "repos",
      "--json",
      "fullName,description,isPrivate,url,updatedAt",
      "--limit",
      "30",
      "--",
      "--web flightdeck",
    ]);
  });

  test("a query with a control character or over 100 characters is refused before gh runs", async () => {
    const gh = fakeGh([SIGNED_IN]);
    const github = new Github({ gh: runGh });
    await expect(github.repos("a\nb")).rejects.toMatchObject({ reason: "query_invalid" });
    await expect(github.repos("x".repeat(101))).rejects.toMatchObject({ reason: "query_invalid" });
    expect(gh.calls()).toEqual([]);
  });

  test("signed out: gh_logged_out; no gh: gh_missing", async () => {
    fakeGh([
      { args: ["auth", "status"], code: 1, stderr: "You are not logged into any GitHub hosts.\n" },
    ]);
    await expect(new Github({ gh: runGh }).repos()).rejects.toMatchObject({
      reason: "gh_logged_out",
    });
    await expect(new Github({ gh: async () => null }).repos()).rejects.toMatchObject({
      reason: "gh_missing",
    });
  });

  test("a login without the repo scope is refused with the scope that is missing", async () => {
    fakeGh([
      {
        args: ["auth", "status"],
        stdout:
          "github.com\n  ✓ Logged in to github.com account octocat (keyring)\n  - Token scopes: 'gist'\n",
      },
    ]);
    await expect(new Github({ gh: runGh }).repos()).rejects.toMatchObject({
      reason: "gh_scope_missing",
      params: { scope: "repo" },
    });
  });

  test("gh fails: repos_failed with what it said", async () => {
    fakeGh([SIGNED_IN, { args: ["repo", "list"], code: 1, stderr: "HTTP 502\n" }]);
    await expect(new Github({ gh: runGh }).repos()).rejects.toMatchObject({
      reason: "repos_failed",
      params: { detail: "HTTP 502" },
    });
  });
});
