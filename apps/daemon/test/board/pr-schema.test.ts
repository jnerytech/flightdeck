import { afterEach, describe, expect, test } from "bun:test";
import { type FakeCli, type FakeRule, installFakeCli } from "../../../../scripts/test/fake-cli.ts";
import { GithubCli } from "../../src/board/pr.ts";
import { tempDir } from "../support/helpers.ts";

// Issue #1609: what a CLI prints is checked against a schema; a reply that does not fit fails the
// call the way unreadable text did, and is never read as an empty or a default value.

const GH_URL = "https://github.com/acme/repo/pull/7";

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
});
