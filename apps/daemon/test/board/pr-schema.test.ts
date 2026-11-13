import { afterEach, describe, expect, test } from "bun:test";
import { type FakeCli, type FakeRule, installFakeCli } from "../../../../scripts/test/fake-cli.ts";
import { AzureDevOpsCli } from "../../src/board/pr.ts";
import { GithubCli } from "../../src/github/index.ts";
import { tempDir } from "../support/helpers.ts";

// Issue #1609: what a CLI prints is checked against a schema; a reply that does not fit fails the
// call the way unreadable text did, and is never read as an empty or a default value.

const GH_URL = "https://github.com/acme/repo/pull/7";
const AZ_URL = "https://dev.azure.com/acme/Proj/_git/repo/pullrequest/7";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn();
});

function fake(name: string, rules: FakeRule[]): FakeCli {
  const cli = installFakeCli(name, rules);
  cleanups.push(cli.restore);
  return cli;
}

const gh = (rules: FakeRule[]) => new GithubCli({ run: fake("gh", rules).run });
const where = () => ({ cwd: tempDir(), url: GH_URL });
const az = (rules: FakeRule[]) => new AzureDevOpsCli({ run: fake("az", rules).run });
const azWhere = () => ({ cwd: tempDir(), url: AZ_URL });

describe("pr schema: GitHub", () => {
  test("status: a PR state that is not text fails the poll, it is not read as open", async () => {
    const provider = gh([{ args: ["pr", "view"], stdout: JSON.stringify({ state: 7 }) }]);
    await expect(provider.status(where())).rejects.toThrow(/does not fit/);
  });

  const NO_THREADS = JSON.stringify({
    data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } },
  });
  const commentsRules = (over: Partial<Record<"pages" | "reviews" | "threads", string>>) => [
    { args: ["api", "--paginate"], stdout: over.pages ?? "[[]]" },
    { args: ["pr", "view", "reviews"], stdout: over.reviews ?? '{"reviews":[]}' },
    { args: ["api", "graphql"], stdout: over.threads ?? NO_THREADS },
  ];

  test("comments: a review comment with no path fails, it is not shown without one", async () => {
    const provider = gh(commentsRules({ pages: JSON.stringify([[{ id: 1 }]]) }));
    await expect(provider.comments(where())).rejects.toThrow(/does not fit/);
  });

  test("comments: a reviews reply that is not a list fails, it is not read as no reviews", async () => {
    const provider = gh(commentsRules({ reviews: JSON.stringify({ reviews: "none" }) }));
    await expect(provider.comments(where())).rejects.toThrow(/does not fit/);
  });

  test("comments: a threads reply without its data fails, it is not read as no resolved thread", async () => {
    const provider = gh(commentsRules({ threads: "{}" }));
    await expect(provider.comments(where())).rejects.toThrow(/does not fit/);
  });

  test("health: a mergeable reply that is not an object fails, it is not read as no conflict", async () => {
    const checks = JSON.stringify([{ name: "ci", bucket: "pass", link: "" }]);
    const provider = gh([
      { args: ["pr", "checks"], stdout: checks },
      { args: ["pr", "view", "mergeable"], stdout: JSON.stringify([]) },
    ]);
    await expect(provider.health(where())).rejects.toThrow(/does not fit/);
  });

  test("replies shaped as gh prints them still read: nulls, an empty decision and extra keys", async () => {
    const status = gh([
      {
        args: ["pr", "view"],
        stdout: JSON.stringify({
          state: "OPEN",
          statusCheckRollup: null,
          mergeStateStatus: "CLEAN",
          reviewDecision: "",
          createdAt: "2026-11-12T10:00:00Z",
          extra: { __typename: "x" },
        }),
      },
    ]);
    expect((await status.status(where())).state).toBe("open");
    const page = [{ id: 5, path: "a.ts", line: null, user: { login: "bob" }, body: "hm" }];
    const threads = {
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: [{ isResolved: true, comments: { nodes: [{ databaseId: null }] } }],
            },
          },
        },
      },
    };
    const comments = gh(
      commentsRules({ pages: JSON.stringify([page]), threads: JSON.stringify(threads) }),
    );
    expect((await comments.comments(where())).map((c) => c.author)).toEqual(["bob"]);
  });
});

describe("pr schema: Azure DevOps", () => {
  const PR_SHOW = ["repos", "pr", "show"];
  const POLICIES = ["repos", "pr", "policy", "list"];

  test("status: a PR status that is not text fails the poll, it is not read as open", async () => {
    const provider = az([
      { args: PR_SHOW, stdout: JSON.stringify({ status: 5 }) },
      { args: POLICIES, stdout: "[]" },
    ]);
    await expect(provider.status(azWhere())).rejects.toThrow(/does not fit/);
  });

  test("status: a policy list that is not a list fails, it is not read as no checks", async () => {
    const provider = az([
      { args: PR_SHOW, stdout: JSON.stringify({ status: "active" }) },
      { args: POLICIES, stdout: "{}" },
    ]);
    await expect(provider.status(azWhere())).rejects.toThrow(/does not fit/);
  });

  test("health: an evaluations reply without its value fails, it is not read as no checks", async () => {
    const show = { mergeStatus: "succeeded", repository: { project: { id: "p1" } } };
    const provider = az([
      { args: PR_SHOW, stdout: JSON.stringify(show) },
      { args: ["devops", "invoke", "evaluations"], stdout: "{}" },
    ]);
    await expect(provider.health(azWhere())).rejects.toThrow(/does not fit/);
  });

  test("comments: a thread without its comments fails, it is not left out", async () => {
    const provider = az([
      {
        args: ["devops", "invoke", "pullRequestThreads"],
        stdout: JSON.stringify({ value: [{ id: 1, status: "active" }] }),
      },
    ]);
    await expect(provider.comments(azWhere())).rejects.toThrow(/does not fit/);
  });

  test("buildLog: a timeline that is not a list of records fails, it is not read as no failure", async () => {
    const provider = az([
      { args: ["devops", "invoke", "timeline"], stdout: JSON.stringify({ records: "none" }) },
    ]);
    await expect(provider.buildLog({ ...azWhere(), buildId: "9" })).rejects.toThrow(/does not fit/);
  });

  test("url: a PR with no repository address fails, it is not turned into a broken link", async () => {
    const provider = az([
      { args: ["repos", "pr", "list"], stdout: JSON.stringify([{ pullRequestId: 7 }]) },
    ]);
    await expect(provider.url({ cwd: tempDir(), head: "feat" })).rejects.toThrow(/does not fit/);
  });

  test("replies shaped as az prints them still read: nulls and extra keys", async () => {
    const provider = az([
      {
        args: PR_SHOW,
        stdout: JSON.stringify({
          status: "active",
          mergeStatus: null,
          reviewers: null,
          creationDate: "2026-11-12T10:00:00Z",
          createdBy: { displayName: "x" },
        }),
      },
      { args: POLICIES, stdout: "[]" },
      {
        args: ["devops", "invoke", "pullRequestThreads"],
        stdout: JSON.stringify({
          value: [
            {
              id: 1,
              threadContext: null,
              comments: [
                { id: 1, author: { displayName: "Ann" }, content: "hi", commentType: "text" },
                { id: 2, author: { displayName: "Bot" }, commentType: "system" },
              ],
            },
          ],
        }),
      },
    ]);
    expect((await provider.status(azWhere())).state).toBe("open");
    expect((await provider.comments(azWhere())).map((c) => c.author)).toEqual(["Ann"]);
  });

  test("health and buildLog read replies with null context, no result and a thread with no path", async () => {
    const show = { mergeStatus: "succeeded", repository: { project: { id: "p1" } } };
    const evaluation = {
      status: "approved",
      configuration: { type: { displayName: "Build" }, settings: null },
      context: { buildId: null },
    };
    const provider = az([
      { args: PR_SHOW, stdout: JSON.stringify(show) },
      {
        args: ["devops", "invoke", "evaluations"],
        stdout: JSON.stringify({ value: [evaluation] }),
      },
      {
        args: ["devops", "invoke", "timeline"],
        stdout: JSON.stringify({ records: [{ type: "Stage", name: "s", log: null }] }),
      },
    ]);
    const health = await provider.health(azWhere());
    expect(health.checks).toMatchObject([{ name: "Build", kind: "policy", buildId: null }]);
    expect(await provider.buildLog({ ...azWhere(), buildId: "9" })).toBe("");
  });
});
