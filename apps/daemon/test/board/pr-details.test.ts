import { afterEach, describe, expect, test } from "bun:test";
import { type FakeRule, installFakeCli } from "../../../../scripts/test/fake-cli.ts";
import { AzureDevOpsCli, GithubCli } from "../../src/board/pr.ts";
import { azureDetails, githubDetails } from "../../src/pr/pr-details.ts";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn();
});
const fake = (name: string, rules: FakeRule[]) => {
  const cli = installFakeCli(name, rules);
  cleanups.push(cli.restore);
  return cli;
};

describe("pr-details: GitHub", () => {
  test("the merge state: clean and unstable merge, dirty conflicts, the rest holds, unknown stays unknown", () => {
    const of = (mergeStateStatus?: string | null) => githubDetails({ mergeStateStatus }).mergeable;
    expect(["CLEAN", "HAS_HOOKS", "UNSTABLE"].map(of)).toEqual(["clean", "clean", "clean"]);
    expect(of("DIRTY")).toBe("conflict");
    expect(["BLOCKED", "BEHIND", "DRAFT"].map(of)).toEqual(["blocked", "blocked", "blocked"]);
    expect([of("UNKNOWN"), of(undefined), of(null), of("SOMETHING_NEW")]).toEqual([
      "unknown",
      "unknown",
      "unknown",
      "unknown",
    ]);
  });

  test("the review decision, and none when GitHub gives an empty one", () => {
    const of = (reviewDecision?: string | null) => githubDetails({ reviewDecision }).review;
    expect(of("APPROVED")).toBe("approved");
    expect(of("CHANGES_REQUESTED")).toBe("changes_requested");
    expect(of("REVIEW_REQUIRED")).toBe("required");
    expect([of(""), of(null), of(undefined)]).toEqual(["none", "none", "none"]);
  });

  test("the open date is kept as GitHub gives it, null when missing", () => {
    expect(githubDetails({ createdAt: "2026-11-09T10:00:00Z" }).openedAt).toBe(
      "2026-11-09T10:00:00Z",
    );
    expect(githubDetails({}).openedAt).toBeNull();
  });
});

describe("pr-details: Azure DevOps", () => {
  test("the merge status", () => {
    const of = (mergeStatus?: string | null) => azureDetails({ mergeStatus }).mergeable;
    expect(of("succeeded")).toBe("clean");
    expect(of("conflicts")).toBe("conflict");
    expect(of("rejectedByPolicy")).toBe("blocked");
    expect([of("queued"), of("failure"), of(undefined)]).toEqual(["unknown", "unknown", "unknown"]);
  });

  test("the reviewers' votes: a rejection or a wait asks for changes, an approval approves", () => {
    const of = (reviewers?: Array<{ vote?: number; isRequired?: boolean }> | null) =>
      azureDetails({ reviewers }).review;
    expect(of([{ vote: 10 }, { vote: 0 }])).toBe("approved");
    expect(of([{ vote: 5 }])).toBe("approved");
    expect(of([{ vote: 10 }, { vote: -10 }])).toBe("changes_requested");
    expect(of([{ vote: -5 }])).toBe("changes_requested");
    expect(of([{ vote: 0, isRequired: true }])).toBe("required");
    expect([of([{ vote: 0 }]), of([]), of(null), of(undefined)]).toEqual([
      "none",
      "none",
      "none",
      "none",
    ]);
  });

  test("the creation date", () => {
    expect(azureDetails({ creationDate: "2026-11-09T10:00:00.5Z" }).openedAt).toBe(
      "2026-11-09T10:00:00.5Z",
    );
    expect(azureDetails({}).openedAt).toBeNull();
  });
});

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
