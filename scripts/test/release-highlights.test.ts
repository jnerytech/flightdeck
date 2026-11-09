import { describe, expect, test } from "bun:test";
import type { GhResult } from "../lib/ci-branch.ts";
import {
  areaOf,
  issueOf,
  type MergedPr,
  REPO,
  releaseHighlights,
  userFacing,
} from "../lib/release-highlights.ts";

/**
 * Issue #1334: the release Highlights drafted from the PRs merged since the last tag. Every `gh`
 * here is a fake that answers by its arguments and records what was asked; nothing reaches GitHub.
 */

const TAG_DATE = "2026-11-08T21:38:12Z";

/** A PR as the search returns it. */
function node(
  number: number,
  title: string,
  commits: string[],
  opts: { closes?: number[]; head?: string; mergedAt?: string; body?: string } = {},
) {
  return {
    number,
    title,
    mergedAt: opts.mergedAt ?? "2026-11-08T22:00:00Z",
    headRefName: opts.head ?? `branch-${number}`,
    closingIssuesReferences: { nodes: (opts.closes ?? []).map((n) => ({ number: n })) },
    commits: {
      nodes: commits.map((headline) => ({
        commit: { messageHeadline: headline, messageBody: opts.body ?? "" },
      })),
    },
  };
}

const PAGE_1 = [
  node(
    10,
    "merge from the card",
    ["test(card-merge): merge asks first", "feat(card-merge): merge from the card (#5)"],
    {
      closes: [5],
    },
  ),
  node(11, "a refused merge says why", ["fix(card-merge): a refused merge says why (#5)"]),
  node(12, "nested ternaries out", ["refactor(sonar-ui): nested ternaries out (#197)"]),
  node(13, "tests assert the state", ["fix(sonar-tests): tests assert the state (#197)"]),
  node(14, "scheduled backups", ["feat(backup-schedule): Settings > Backup schedule"], {
    body: "Keeps the last N.\n\nRefs: #6",
  }),
];
const PAGE_2 = [
  node(15, "chore(versao): v0.37.17", ["chore(versao): v0.37.17"], { head: "release-v0.37.17" }),
  node(16, "merged with the tag", ["feat(x): merged with the tag (#9)"], { mergedAt: TAG_DATE }),
  node(17, "the team's outcome", ["feat(team-card): the outcome heads the card (#7)"], {
    closes: [7],
  }),
  node(18, "fix(quota-alert): budget alert reads right", [
    "fix(quota-alert): budget alert reads right",
  ]),
  node(19, "manuals", ["docs(manual): the team's outcome"], { closes: [8] }),
];
const TITLES: Record<number, string> = {
  5: "Card: merge its open PR from the card",
  6: "Backup follow-ups: scheduled backups keeping the last N",
  7: "Teams: the team's outcome in one place",
};

const ok = (stdout: string): GhResult => ({ code: 0, stdout, stderr: "" });

/** A gh that answers the release, the tag's date, the two search pages and the issue titles. */
function fakeGh(overrides: { release?: GhResult } = {}) {
  const calls: string[][] = [];
  const gh = async (args: string[]): Promise<GhResult> => {
    calls.push(args);
    if (args[0] === "release") return overrides.release ?? ok("v0.37.16\n");
    if (args[1] === `repos/${REPO}/commits/v0.37.16`) return ok(`${TAG_DATE}\n`);
    if (args[0] === "api" && args[1] === "graphql") {
      if (args.some((a) => a.startsWith("q="))) {
        const second = args.includes("after=C1");
        const search = {
          pageInfo: { hasNextPage: !second, endCursor: second ? null : "C1" },
          nodes: second ? PAGE_2 : PAGE_1,
        };
        return ok(JSON.stringify({ data: { search } }));
      }
      const repository: Record<string, { title: string }> = {};
      for (const [n, title] of Object.entries(TITLES)) {
        if (args.some((a) => a.includes(`i${n}:`))) repository[`i${n}`] = { title };
      }
      return ok(JSON.stringify({ data: { repository } }));
    }
    return { code: 1, stdout: "", stderr: `unexpected gh ${args.join(" ")}` };
  };
  return { gh, calls };
}

describe("release highlights draft (#1334)", () => {
  test("the PRs merged since the last tag become one bullet per issue, under its area", async () => {
    const { gh, calls } = fakeGh();
    const lines: string[] = [];
    expect(await releaseHighlights([], { gh, log: (line) => lines.push(line) })).toBe(0);
    expect(lines.join("\n")).toBe(
      [
        "## Highlights (draft)",
        "",
        "Since v0.37.16: 9 merged PRs, 5 user-facing in 4 entries. Edit before publishing.",
        "",
        "**Board**",
        "- Card: merge its open PR from the card (#10, #11, #5)",
        "",
        "**Sessions**",
        "- Teams: the team's outcome in one place (#17, #7)",
        "",
        "**Costs**",
        "- budget alert reads right (#18)",
        "",
        "**Backup**",
        "- Backup follow-ups: scheduled backups keeping the last N (#14, #6)",
      ].join("\n"),
    );
    // The search asks for main's merged PRs from the tag's date, and follows the cursor.
    const searches = calls.filter((c) => c.some((a) => a.startsWith("q=")));
    expect(searches.length).toBe(2);
    expect(
      searches[0]?.includes(`q=repo:${REPO} is:pr is:merged base:main merged:>=${TAG_DATE}`),
    ).toBe(true);
  });

  test("--since names the tag; a tag that is not a version is refused before any gh call", async () => {
    const { gh, calls } = fakeGh();
    const lines: string[] = [];
    expect(
      await releaseHighlights(["--since", "v0.37.16"], { gh, log: (l) => lines.push(l) }),
    ).toBe(0);
    expect(calls.some((c) => c[0] === "release")).toBe(false);
    const refused = fakeGh();
    const said: string[] = [];
    expect(
      await releaseHighlights(["--since", "v1; rm -rf ~"], {
        gh: refused.gh,
        log: (l) => said.push(l),
      }),
    ).toBe(2);
    expect(refused.calls).toEqual([]);
    expect(said).toEqual(["release-highlights: --since takes a version tag such as v0.37.16"]);
  });

  test("GitHub that cannot be read stops it with gh's own words", async () => {
    const { gh } = fakeGh({ release: { code: 1, stdout: "", stderr: "HTTP 502\n" } });
    const lines: string[] = [];
    expect(await releaseHighlights([], { gh, log: (l) => lines.push(l) })).toBe(1);
    expect(lines).toEqual(["release-highlights: could not read the last release: HTTP 502"]);
  });
});

const pr = (
  commits: string[],
  opts: { closes?: number[]; head?: string; body?: string } = {},
): MergedPr => ({
  number: 1,
  title: "t",
  mergedAt: "2026-11-08T22:00:00Z",
  headRefName: opts.head ?? "b",
  closes: opts.closes ?? [],
  commits: commits.map((headline) => ({ headline, body: opts.body ?? "" })),
});

describe("what counts as user-facing, and its issue (#1334)", () => {
  test("a feat or fix commit counts; test, refactor, chore, docs, the Sonar, CI, BDD and e2e scopes and a release bump do not", () => {
    expect(userFacing(pr(["test(a): x", "feat(a): x"]))).toBe(true);
    expect(userFacing(pr(["fix: x"]))).toBe(true);
    expect(userFacing(pr(["feat(a)!: x"]))).toBe(true);
    for (const headline of [
      "test(a): x",
      "refactor(a): x",
      "chore(a): x",
      "docs(a): x",
      "fix(sonar-ui): x",
      "feat(ci-shards): x",
      "fix(ci): x",
      "fix(bdd): x",
      "test(e2e-journeys): x",
      "fix(e2e-journeys): x",
    ]) {
      expect([headline, userFacing(pr([headline]))]).toEqual([headline, false]);
    }
    expect(userFacing(pr(["feat(versao): x"], { head: "release-v0.37.17" }))).toBe(false);
  });

  test("the closed issue wins; else the one its feat and fix commits name most, by (#N) or Refs", () => {
    expect(issueOf(pr(["feat(a): x (#3)"], { closes: [9] }))).toBe(9);
    expect(
      issueOf(
        pr([
          "feat(a): x (#3)",
          "fix(a): y (#4)",
          "fix(a): z (#4)",
          "test(a): w (#5)",
          "test(a): v (#5)",
        ]),
      ),
    ).toBe(4);
    expect(issueOf(pr(["feat(a): x"], { body: "Why.\n\nRefs: #12" }))).toBe(12);
    expect(issueOf(pr(["feat(a): x", "test(a): y (#5)"]))).toBe(null);
    // GitHub cuts a long headline with "…" and moves the rest, with its (#N), into the body.
    expect(issueOf(pr(["feat(a): a long headline that GitHub cuts…"], { body: "…and its tail (#21)" }))).toBe(21);
    // No commit names one: the PR's title may.
    expect(issueOf({ ...pr(["feat(a): x"]), title: "the merge asks first (#22)" })).toBe(22);
  });

  test("an area comes from the issue's words", () => {
    expect(areaOf("Backup follow-ups: host URL in the restore preview")).toBe("Backup");
    expect(areaOf("Budgets in quota terms for a subscription")).toBe("Costs");
    expect(areaOf("Gate card shows two primaries")).toBe("Workflows");
    expect(areaOf("Host health: Start at boot")).toBe("Hosts");
    expect(areaOf("Card: merge its open PR from the card")).toBe("Board");
    expect(areaOf("Teams: the team's outcome in one place")).toBe("Sessions");
    expect(areaOf("Demo: a card with an open PR, so Merge PR has a print")).toBe("Quality");
    expect(areaOf("Lint: an error is hidden behind Biome's cap, so a PR's lint log shows only infos")).toBe("Quality");
    expect(areaOf("Harness: a red main is claimed once, and every session sees the claim")).toBe("Quality");
    expect(areaOf("Something else entirely")).toBe("Other");
  });
});
