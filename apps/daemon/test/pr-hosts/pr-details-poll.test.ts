import { afterEach, describe, expect, test } from "bun:test";
import { type FakeRule, installFakeCli } from "../../../../scripts/test/fake-cli.ts";
import { GithubCli } from "../../src/github/index.ts";
import { AzureDevOpsCli } from "../../src/pr-hosts/pr.ts";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn();
});
const fake = (name: string, rules: FakeRule[]) => {
  const cli = installFakeCli(name, rules);
  cleanups.push(cli.restore);
  return cli;
};

describe("pr-details: the poll's own read", () => {
  test("gh asks for the details in the same call as the state and the checks", async () => {
    const gh = fake("gh", [
      {
        args: ["view", "state,statusCheckRollup,mergeStateStatus,reviewDecision,createdAt"],
        stdout: JSON.stringify({
          state: "OPEN",
          statusCheckRollup: [{ conclusion: "SUCCESS" }],
          mergeStateStatus: "DIRTY",
          reviewDecision: "REVIEW_REQUIRED",
          createdAt: "2026-11-09T10:00:00Z",
        }),
      },
    ]);
    const url = "https://github.com/acme/repo/pull/7";
    const status = await new GithubCli({ run: gh.run }).status({ cwd: ".", url });
    expect(status).toMatchObject({
      state: "open",
      checks: "passing",
      mergeable: "conflict",
      review: "required",
      openedAt: "2026-11-09T10:00:00Z",
    });
    expect(gh.calls()).toEqual([
      [
        "pr",
        "view",
        url,
        "--json",
        "state,statusCheckRollup,mergeStateStatus,reviewDecision,createdAt",
      ],
    ]);
  });

  test("az reads the details from the PR it already shows", async () => {
    const az = fake("az", [
      { args: ["policy", "list"], stdout: "[]" },
      {
        args: ["pr", "show"],
        stdout: JSON.stringify({
          status: "active",
          mergeStatus: "conflicts",
          reviewers: [{ vote: -10 }],
          creationDate: "2026-11-09T10:00:00Z",
        }),
      },
    ]);
    const url = "https://dev.azure.com/acme/proj/_git/repo/pullrequest/12";
    const status = await new AzureDevOpsCli({ run: az.run }).status({ cwd: ".", url });
    expect(status).toMatchObject({
      state: "open",
      mergeable: "conflict",
      review: "changes_requested",
      openedAt: "2026-11-09T10:00:00Z",
    });
  });
});
