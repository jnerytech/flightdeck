import type { PrState } from "@flightdeck/protocol";
import { FlightdeckError } from "../../kernel/index.ts";
import {
  BUILD_LOG_BYTES,
  CliProvider,
  type CreatePr,
  githubDetails,
  type PrCheck,
  type PrComment,
  type PrHealth,
  type PrProvider,
  type PrStatus,
  summarize,
  tail,
  urlName,
} from "../../pr/index.ts";
import {
  GhCommentPages,
  GhMergeable,
  GhMergeState,
  GhPrStatus,
  GhReviews,
  GhThreads,
  parseChecks,
  parsePrUrl,
} from "./gh-json.ts";

/** Which review threads are resolved: GitHub's REST API does not say. */
const GH_THREADS = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        nodes { isResolved comments(first: 100) { nodes { databaseId } } }
      }
    }
  }
}`;

const GH_STATES: Record<string, PrState> = { OPEN: "open", MERGED: "merged", CLOSED: "closed" };
const GH_PASS = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);
const GH_FAIL = new Set(["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED"]);

/** The parts of a GitHub PR URL, the names checked before they reach `gh`. */
function ghParts(url: string): { owner: string; repo: string; number: string; prUrl: string } {
  const match = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(url);
  if (!match)
    throw new FlightdeckError("invalid_state", `invalid GitHub PR URL: ${url}`, "pr_url_invalid", {
      provider: "GitHub",
      url,
    });
  const [, rawOwner, rawRepo, number] = match as unknown as [string, string, string, string];
  const owner = urlName("dono", rawOwner);
  const repo = urlName("repositório", rawRepo);
  // Rebuilt: the stored URL may carry anything around the part that matched.
  return { owner, repo, number, prUrl: `https://github.com/${owner}/${repo}/pull/${number}` };
}

/** A CLI's words with what looks like a token left out: GitHub tokens, auth headers and URL credentials. */
function withoutTokens(text: string): string {
  return text
    .replace(/\bgh[pousr]_\w+/g, "[token]")
    .replace(/\bgithub_pat_\w+/g, "[token]")
    .replace(/\bBearer\s+\S+/gi, "[token]")
    .replace(/\bBasic\s+\S+/g, "[token]")
    .replace(/\/\/[^/@\s]+@/g, "//[token]@");
}

const GH_BUCKETS: Record<string, PrCheck["state"]> = {
  pass: "passing",
  skipping: "passing",
  fail: "failing",
  cancel: "failing",
};

/** GitHub through `gh`. */
export class GithubCli extends CliProvider implements PrProvider {
  /**
   * #1196: `gh pr merge <url> --merge|--squash`, and nothing else: no `--admin` (rules stay), no
   * `--auto`, no branch delete, no message of ours. When gh refuses, it is asked once more, with a
   * read, why the PR cannot be merged, so the refusal says that and not gh's own words.
   */
  async merge({
    cwd,
    url,
    method,
  }: {
    cwd: string;
    url: string;
    method: "merge" | "squash";
  }): Promise<void> {
    // Rebuilt from its parts: the stored address never reaches gh as it is.
    const { prUrl } = ghParts(url);
    const result = await this.call("gh", ["pr", "merge", prUrl, `--${method}`], cwd);
    if (result.code === 0) return;
    const reason = await this.whyNotMergeable(cwd, prUrl);
    // gh's words travel as the detail of the unknown refusal only, never the message, and without tokens.
    const detail = withoutTokens(result.stderr.trim()).slice(0, 300);
    throw new FlightdeckError("invalid_state", "the PR could not be merged", reason, {
      url: prUrl,
      ...(reason === "card_pr_merge_failed" ? { detail } : {}),
    });
  }

  /** Why GitHub holds the PR back, from its merge state, its review decision and its checks. */
  private async whyNotMergeable(cwd: string, url: string): Promise<string> {
    const state = await this.jsonWith(
      GhMergeState,
      "gh",
      ["pr", "view", url, "--json", "mergeStateStatus,reviewDecision,statusCheckRollup"],
      cwd,
    ).catch(() => null);
    if (state === null) return "card_pr_merge_failed";
    if (state.mergeStateStatus === "DIRTY") return "card_pr_conflict";
    if (
      state.reviewDecision === "REVIEW_REQUIRED" ||
      state.reviewDecision === "CHANGES_REQUESTED"
    ) {
      return "card_pr_review_required";
    }
    const checks = summarize(
      (state.statusCheckRollup ?? []).map((check) => {
        const result = (check.conclusion ?? check.state ?? "").toUpperCase();
        if (GH_FAIL.has(result)) return "failing" as const;
        return GH_PASS.has(result) ? ("passing" as const) : ("pending" as const);
      }),
    );
    return checks === "failing" || checks === "pending"
      ? "card_pr_checks_failing"
      : "card_pr_merge_failed";
  }

  async create(opts: CreatePr): Promise<string> {
    const existing = await this.url(opts);
    if (existing) return existing;
    const { cwd, base, head, title, body } = opts;
    const args = ["pr", "create", "--base", base, "--head", head, "--title", title, "--body", body];
    // gh prints progress lines before the URL.
    const out = await this.ok("gh", args, cwd);
    return out.trim().split(/\r?\n/).at(-1) ?? "";
  }

  async status({ cwd, url }: { cwd: string; url: string }): Promise<PrStatus> {
    const pr = await this.jsonWith(
      GhPrStatus,
      "gh",
      [
        "pr",
        "view",
        url,
        "--json",
        "state,statusCheckRollup,mergeStateStatus,reviewDecision,createdAt",
      ],
      cwd,
    );
    const rollup = pr.statusCheckRollup ?? [];
    const checks = rollup.map((check) => {
      const result = (check.conclusion ?? check.state ?? "").toUpperCase();
      if (GH_FAIL.has(result)) return "failing" as const;
      return GH_PASS.has(result) ? ("passing" as const) : ("pending" as const);
    });
    const failed = rollup
      .filter((_, i) => checks[i] === "failing")
      .map((check) => check.name ?? check.context ?? "")
      .filter((name) => name !== "");
    return {
      state: GH_STATES[pr.state] ?? "open",
      checks: summarize(checks),
      ...(failed.length > 0 ? { failed } : {}),
      ...githubDetails(pr),
    };
  }

  /**
   * Review comments (REST), the summaries of the reviews, and which threads are resolved
   * (GraphQL, a query: nothing is written).
   */
  async comments({ cwd, url }: { cwd: string; url: string }): Promise<PrComment[]> {
    const { owner, repo, number, prUrl } = ghParts(url);
    // Every page, 100 at a time (the REST default is 30): `--slurp` wraps the pages in an array.
    // A plain GET: no -f/-F field, which would make `gh api` a POST.
    const pages = await this.jsonWith(
      GhCommentPages,
      "gh",
      [
        "api",
        "--paginate",
        "--slurp",
        `repos/${owner}/${repo}/pulls/${number}/comments?per_page=100`,
      ],
      cwd,
    );
    const inline = pages.flat();
    const { reviews } = await this.jsonWith(
      GhReviews,
      "gh",
      ["pr", "view", prUrl, "--json", "reviews"],
      cwd,
    );
    const threads = await this.jsonWith(
      GhThreads,
      "gh",
      [
        "api",
        "graphql",
        // From stdin: the query's characters do not survive a .cmd wrapper on Windows.
        "-F",
        "query=@-",
        // -f sends the value as it is; -F would read a file for a value starting with @.
        "-f",
        `owner=${owner}`,
        "-f",
        `name=${repo}`,
        // The number is digits only (the URL pattern), typed as the Int the query declares.
        "-F",
        `number=${number}`,
      ],
      cwd,
      GH_THREADS,
    );
    const resolved = new Set(
      threads.data.repository.pullRequest.reviewThreads.nodes
        .filter((thread) => thread.isResolved)
        .flatMap((thread) => thread.comments.nodes.map((c) => c.databaseId)),
    );
    return [
      ...inline.map(
        (c): PrComment => ({
          id: String(c.id),
          path: c.path,
          line: c.line ?? c.original_line ?? null,
          author: c.user.login,
          authorAssociation: c.author_association ?? null,
          authorIdentity: null,
          body: c.body,
          resolved: resolved.has(c.id),
          kind: "inline",
        }),
      ),
      ...reviews
        .filter((review) => review.body.trim())
        .map(
          (review): PrComment => ({
            id: `review-${review.id}`,
            path: null,
            line: null,
            author: review.author.login,
            authorAssociation: review.authorAssociation ?? null,
            authorIdentity: null,
            body: review.body,
            resolved: false,
            kind: "review",
          }),
        ),
    ];
  }

  /**
   * `gh pr checks` (it exits non-zero while a check fails or is pending, with the JSON on
   * stdout all the same) and the PR's `mergeable` state.
   */
  async health({ cwd, url }: { cwd: string; url: string }): Promise<PrHealth> {
    const { prUrl } = ghParts(url);
    const result = await this.call(
      "gh",
      ["pr", "checks", prUrl, "--json", "name,bucket,link"],
      cwd,
    );
    if (!result.stdout.trim()) {
      throw new FlightdeckError(
        "invalid_state",
        `gh pr checks failed: ${result.stderr.trim()}`,
        "command_failed",
        { what: "gh pr checks", output: result.stderr.trim() },
      );
    }
    const rows = parseChecks(result.stdout);
    const { mergeable } = await this.jsonWith(
      GhMergeable,
      "gh",
      ["pr", "view", prUrl, "--json", "mergeable"],
      cwd,
    );
    return {
      checks: rows.map((row): PrCheck => {
        const runId = /\/actions\/runs\/(\d+)/.exec(row.link)?.[1] ?? null;
        return {
          name: row.name,
          state: GH_BUCKETS[row.bucket] ?? "pending",
          kind: runId === null ? "policy" : "build",
          buildId: runId,
        };
      }),
      conflicts: mergeable === "CONFLICTING",
    };
  }

  /** The end of what failed in a run of GitHub Actions, 16 KB at most. */
  async buildLog({
    cwd,
    url,
    buildId,
  }: {
    cwd: string;
    url: string;
    buildId: string;
  }): Promise<string> {
    const { owner, repo } = ghParts(url);
    const text = await this.ok(
      "gh",
      ["run", "view", urlName("run", buildId), "--repo", `${owner}/${repo}`, "--log-failed"],
      cwd,
    );
    return tail(text, BUILD_LOG_BYTES);
  }

  async url({ cwd, head }: { cwd: string; head: string }): Promise<string | null> {
    const result = await this.call("gh", ["pr", "view", head, "--json", "url"], cwd);
    return result.code === 0 ? parsePrUrl(result.stdout) : null;
  }
}
