import { FlightdeckError } from "../errors.ts";
import { whichOnPath } from "../which.ts";
import { type CommandResult, runCommand } from "./command.ts";
import type { ChecksState, PrProviderKind, PrState } from "./types.ts";

export interface PrStatus {
  state: PrState;
  checks: ChecksState | null;
}

export interface CreatePr {
  cwd: string;
  base: string;
  head: string;
  title: string;
  body: string;
}

/** A review comment of a PR, read from the provider (phase 11); nothing is ever posted back. */
export interface PrComment {
  id: string;
  /** `null` for a review's summary, which is about the whole PR. */
  path: string | null;
  line: number | null;
  author: string;
  body: string;
  resolved: boolean;
  kind: "inline" | "review";
}

interface GhComment {
  id: number;
  path: string;
  line?: number | null;
  original_line?: number | null;
  user: { login: string };
  body: string;
}

interface GhReview {
  id: string;
  author: { login: string };
  body: string;
}

interface GhThreads {
  data: {
    repository: {
      pullRequest: {
        reviewThreads: {
          nodes: Array<{ isResolved: boolean; comments: { nodes: Array<{ databaseId: number }> } }>;
        };
      };
    };
  };
}

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

interface AzThread {
  id: number;
  status: string;
  isDeleted?: boolean;
  threadContext: { filePath: string; rightFileStart?: { line: number } | null } | null;
  comments: Array<{
    id: number;
    author: { displayName: string };
    content: string;
    commentType: string;
  }>;
}

const AZ_RESOLVED = new Set(["fixed", "closed", "wontFix", "byDesign"]);

/** The chosen PR comments as one message to the agent, like the inline review. */
export function prMessage(comments: readonly PrComment[]): string {
  return [
    "Comentários do PR:",
    ...comments.map((c, i) => {
      const where = c.path
        ? `\`${c.path}\`${c.line === null ? "" : ` linha ${c.line}`} (${c.author})`
        : `revisão de ${c.author}`;
      const body = c.body
        .replace(/\r?\n$/, "")
        .split(/\r?\n/)
        .map((line) => `   ${line}`)
        .join("\n");
      return `${i + 1}. ${where}:\n${body}`;
    }),
  ].join("\n");
}

/** A PR host reached through its CLI, which must be installed and logged in on this host. */
export interface PrProvider {
  /** Opens the PR (or reuses the one already open for `head`) and returns its URL. */
  create(opts: CreatePr): Promise<string>;
  status(opts: { cwd: string; url: string }): Promise<PrStatus>;
  /** URL of the open PR for `head`, if any. */
  url(opts: { cwd: string; head: string }): Promise<string | null>;
  /** The PR's review comments and review summaries. */
  comments(opts: { cwd: string; url: string }): Promise<PrComment[]>;
}

/** Runs a CLI looked up on the current PATH (so the tests' fakes win). */
async function cli(
  name: string,
  args: string[],
  cwd: string,
  input?: string,
): Promise<CommandResult> {
  const bin = whichOnPath(name);
  if (!bin) throw new FlightdeckError("invalid_state", `${name} não encontrado no PATH`);
  return runCommand([bin, ...args], cwd, input);
}

/** Stdout of a CLI call that must succeed; the error names the subcommand (`gh pr view`). */
async function cliOk(name: string, args: string[], cwd: string, input?: string): Promise<string> {
  const result = await cli(name, args, cwd, input);
  if (result.code !== 0) {
    const what = [name, ...args.slice(0, name === "az" ? 3 : 2)].join(" ");
    throw new FlightdeckError("invalid_state", `${what} falhou: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

const cliJson = async <T>(name: string, args: string[], cwd: string, input?: string): Promise<T> =>
  JSON.parse(await cliOk(name, args, cwd, input)) as T;

/** Worst check wins: any failure fails, anything unfinished is pending; no checks, `null`. */
function summarize(results: Array<"passing" | "failing" | "pending">): ChecksState | null {
  if (results.length === 0) return null;
  if (results.includes("failing")) return "failing";
  return results.includes("pending") ? "pending" : "passing";
}

const GH_STATES: Record<string, PrState> = { OPEN: "open", MERGED: "merged", CLOSED: "closed" };
const GH_PASS = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);
const GH_FAIL = new Set(["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED"]);

interface GhCheck {
  conclusion?: string | null;
  state?: string | null;
}

/** GitHub through `gh`. */
export class GithubCli implements PrProvider {
  async create(opts: CreatePr): Promise<string> {
    const existing = await this.url(opts);
    if (existing) return existing;
    const { cwd, base, head, title, body } = opts;
    const args = ["pr", "create", "--base", base, "--head", head, "--title", title, "--body", body];
    // gh prints progress lines before the URL.
    const out = await cliOk("gh", args, cwd);
    return out.trim().split(/\r?\n/).at(-1) ?? "";
  }

  async status({ cwd, url }: { cwd: string; url: string }): Promise<PrStatus> {
    const pr = await cliJson<{ state: string; statusCheckRollup?: GhCheck[] }>(
      "gh",
      ["pr", "view", url, "--json", "state,statusCheckRollup"],
      cwd,
    );
    const checks = (pr.statusCheckRollup ?? []).map((check) => {
      const result = (check.conclusion ?? check.state ?? "").toUpperCase();
      if (GH_FAIL.has(result)) return "failing" as const;
      return GH_PASS.has(result) ? ("passing" as const) : ("pending" as const);
    });
    return { state: GH_STATES[pr.state] ?? "open", checks: summarize(checks) };
  }

  /**
   * Review comments (REST), the summaries of the reviews, and which threads are resolved
   * (GraphQL, a query: nothing is written).
   */
  async comments({ cwd, url }: { cwd: string; url: string }): Promise<PrComment[]> {
    const match = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(url);
    if (!match) throw new FlightdeckError("invalid_state", `URL de PR do GitHub inválida: ${url}`);
    const [, owner, repo, number] = match as unknown as [string, string, string, string];
    // Every page, 100 at a time (the REST default is 30): `--slurp` wraps the pages in an array.
    // A plain GET: no -f/-F field, which would make `gh api` a POST.
    const pages = await cliJson<GhComment[][]>(
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
    const { reviews } = await cliJson<{ reviews: GhReview[] }>(
      "gh",
      ["pr", "view", url, "--json", "reviews"],
      cwd,
    );
    const threads = await cliJson<GhThreads>(
      "gh",
      [
        "api",
        "graphql",
        // From stdin: the query's characters do not survive a .cmd wrapper on Windows.
        "-F",
        "query=@-",
        `owner=${owner}`,
        "-F",
        `name=${repo}`,
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
            body: review.body,
            resolved: false,
            kind: "review",
          }),
        ),
    ];
  }

  async url({ cwd, head }: { cwd: string; head: string }): Promise<string | null> {
    const result = await cli("gh", ["pr", "view", head, "--json", "url"], cwd);
    if (result.code !== 0) return null;
    return (JSON.parse(result.stdout) as { url: string }).url;
  }
}

interface AzPr {
  pullRequestId: number;
  repository: { webUrl: string };
}

const AZ_STATES: Record<string, PrState> = {
  active: "open",
  completed: "merged",
  abandoned: "closed",
};
const AZ_PASS = new Set(["approved", "notApplicable"]);
const AZ_FAIL = new Set(["rejected", "broken"]);

const azUrl = (pr: AzPr) => `${pr.repository.webUrl}/pullrequest/${pr.pullRequestId}`;

/** Azure DevOps through `az repos` (organization and project detected from the remote). */
export class AzureDevOpsCli implements PrProvider {
  async create(opts: CreatePr): Promise<string> {
    const existing = await this.url(opts);
    if (existing) return existing;
    const { cwd, base, head, title, body } = opts;
    const pr = await cliJson<AzPr>(
      "az",
      [
        "repos",
        "pr",
        "create",
        "--source-branch",
        head,
        "--target-branch",
        base,
        "--title",
        title,
        "--description",
        body,
        "--output",
        "json",
      ],
      cwd,
    );
    return azUrl(pr);
  }

  async status({ cwd, url }: { cwd: string; url: string }): Promise<PrStatus> {
    const id = /\/pullrequest\/(\d+)/.exec(url)?.[1] ?? "";
    const pr = await cliJson<{ status: string }>(
      "az",
      ["repos", "pr", "show", "--id", id, "--output", "json"],
      cwd,
    );
    const policies = await cliJson<Array<{ status: string }>>(
      "az",
      ["repos", "pr", "policy", "list", "--id", id, "--output", "json"],
      cwd,
    );
    const checks = policies.map(({ status }) => {
      if (AZ_FAIL.has(status)) return "failing" as const;
      return AZ_PASS.has(status) ? ("passing" as const) : ("pending" as const);
    });
    return { state: AZ_STATES[pr.status] ?? "open", checks: summarize(checks) };
  }

  async url({ cwd, head }: { cwd: string; head: string }): Promise<string | null> {
    const prs = await cliJson<AzPr[]>(
      "az",
      ["repos", "pr", "list", "--source-branch", head, "--status", "active", "--output", "json"],
      cwd,
    );
    const [first] = prs;
    return first ? azUrl(first) : null;
  }

  /**
   * The PR's threads through `az devops invoke` (the `az repos pr` commands have none): each
   * comment of a person, with the thread's file, line and status.
   */
  async comments({ cwd, url }: { cwd: string; url: string }): Promise<PrComment[]> {
    const match =
      /^(https:\/\/dev\.azure\.com\/[^/]+|https:\/\/[^/]+\.visualstudio\.com)\/([^/]+)\/_git\/([^/]+)\/pullrequest\/(\d+)/.exec(
        url,
      );
    if (!match) throw new FlightdeckError("invalid_state", `URL de PR do Azure inválida: ${url}`);
    const [, org, project, repo, id] = match as unknown as [string, string, string, string, string];
    const { value } = await cliJson<{ value: AzThread[] }>(
      "az",
      [
        "devops",
        "invoke",
        "--area",
        "git",
        "--resource",
        "pullRequestThreads",
        "--route-parameters",
        `project=${project}`,
        `repositoryId=${repo}`,
        `pullRequestId=${id}`,
        "--org",
        org,
        "--api-version",
        "7.1",
        "--output",
        "json",
      ],
      cwd,
    );
    return value
      .filter((thread) => !thread.isDeleted)
      .flatMap((thread) =>
        thread.comments
          .filter((comment) => comment.commentType !== "system")
          .map(
            (comment): PrComment => ({
              id: `${thread.id}/${comment.id}`,
              path: thread.threadContext?.filePath.replace(/^\//, "") ?? null,
              line: thread.threadContext?.rightFileStart?.line ?? null,
              author: comment.author.displayName,
              body: comment.content,
              resolved: AZ_RESOLVED.has(thread.status),
              kind: thread.threadContext ? "inline" : "review",
            }),
          ),
      );
  }
}

/** The provider registered for a project; `none` has none. */
export function prProvider(kind: PrProviderKind): PrProvider | null {
  if (kind === "github") return new GithubCli();
  return kind === "azure-devops" ? new AzureDevOpsCli() : null;
}
