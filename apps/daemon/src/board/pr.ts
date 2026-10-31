import { FlightdeckError } from "../errors.ts";
import { whichOnPath } from "../which.ts";
import { mapSpawnError, sanitizeAzArgs } from "./az-text.ts";
import { type CommandResult, runCommand } from "./command.ts";
import type { ChecksState, PrProviderKind, PrState } from "./types.ts";

export interface PrStatus {
  state: PrState;
  checks: ChecksState | null;
  /** Phase 13: the names of the checks that failed, when the host says. */
  failed?: string[];
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
  /** GitHub's `author_association` (OWNER, MEMBER, COLLABORATOR, CONTRIBUTOR, NONE…). */
  authorAssociation: string | null;
  /** Azure DevOps' identity of the author: `uniqueName`, else the id. */
  authorIdentity: string | null;
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
  author_association?: string | null;
  body: string;
}

interface GhReview {
  id: string;
  author: { login: string };
  authorAssociation?: string | null;
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
    author: { displayName: string; uniqueName?: string; id?: string };
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

/** One check of a PR: a build or a policy the host evaluates (phase 22). */
export interface PrCheck {
  name: string;
  state: "passing" | "failing" | "pending";
  /** A build can be read for its log; any other policy cannot be fixed by code. */
  kind: "build" | "policy";
  /** The host's id of the build behind the check, to fetch its log. */
  buildId: string | null;
}

/** What the PR watcher reads of a PR each round (phase 22). */
export interface PrHealth {
  checks: PrCheck[];
  /** The PR cannot be merged into its target as it is. */
  conflicts: boolean;
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
  /** Phase 22: the PR's builds and policies, and whether it conflicts with its target. */
  health(opts: { cwd: string; url: string }): Promise<PrHealth>;
  /** Phase 22: the end of the log of what failed in a build, at most 16 KB. */
  buildLog(opts: { cwd: string; url: string; buildId: string }): Promise<string>;
}

/** Runs a CLI looked up on the current PATH (so the tests' fakes win). */
export async function cli(
  name: string,
  args: string[],
  cwd: string,
  input?: string,
): Promise<CommandResult> {
  const bin = whichOnPath(name);
  if (!bin) throw new FlightdeckError("invalid_state", `${name} não encontrado no PATH`);
  // The Azure CLI's free text is made safe for its .cmd shim (az-text.ts); the others keep theirs.
  const safe = name === "az" ? sanitizeAzArgs(args) : args;
  return runCommand([bin, ...safe], cwd, input).catch(mapSpawnError);
}

/** Stdout of a CLI call that must succeed; the error names the subcommand (`gh pr view`). */
export async function cliOk(
  name: string,
  args: string[],
  cwd: string,
  input?: string,
): Promise<string> {
  const result = await cli(name, args, cwd, input);
  if (result.code !== 0) {
    const what = [name, ...args.slice(0, name === "az" ? 3 : 2)].join(" ");
    throw new FlightdeckError("invalid_state", `${what} falhou: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

/**
 * A name taken from a PR URL, before it goes into a CLI argument. `az` replaces an argument that
 * starts with @ (and every `name=@file`) by the content of that file, and `gh api -F name=@file`
 * does the same: a repository or project called "@..." would make the CLI read a local file and
 * send it away. A line break has no place in a name either.
 */
function urlName(what: string, value: string): string {
  const control = [...value].some((char) => char.charCodeAt(0) < 32);
  if (value === "" || value.startsWith("@") || control) {
    throw new FlightdeckError(
      "invalid_state",
      `${what} inválido na URL do PR: ${JSON.stringify(value)}`,
    );
  }
  return value;
}

export const cliJson = async <T>(
  name: string,
  args: string[],
  cwd: string,
  input?: string,
): Promise<T> => JSON.parse(await cliOk(name, args, cwd, input)) as T;

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
  name?: string;
  context?: string;
}

/** The parts of a GitHub PR URL, the names checked before they reach `gh`. */
function ghParts(url: string): { owner: string; repo: string; number: string; prUrl: string } {
  const match = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(url);
  if (!match) throw new FlightdeckError("invalid_state", `URL de PR do GitHub inválida: ${url}`);
  const [, rawOwner, rawRepo, number] = match as unknown as [string, string, string, string];
  const owner = urlName("dono", rawOwner);
  const repo = urlName("repositório", rawRepo);
  // Rebuilt: the stored URL may carry anything around the part that matched.
  return { owner, repo, number, prUrl: `https://github.com/${owner}/${repo}/pull/${number}` };
}

const GH_BUCKETS: Record<string, PrCheck["state"]> = {
  pass: "passing",
  skipping: "passing",
  fail: "failing",
  cancel: "failing",
};

/** What a build log keeps in all: the end of the logs of what failed. */
export const BUILD_LOG_BYTES = 16 * 1024;

/** The last `limit` bytes of a text, with a mark when something was left out. */
export function tail(text: string, limit: number): string {
  const bytes = Buffer.from(text);
  if (bytes.length <= limit) return text;
  return `[…]\n${bytes
    .subarray(bytes.length - limit)
    .toString("utf8")
    .replace(/^\uFFFD+/, "")}`;
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
      ["pr", "view", prUrl, "--json", "reviews"],
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
    const result = await cli("gh", ["pr", "checks", prUrl, "--json", "name,bucket,link"], cwd);
    if (!result.stdout.trim()) {
      throw new FlightdeckError("invalid_state", `gh pr checks falhou: ${result.stderr.trim()}`);
    }
    const rows = JSON.parse(result.stdout) as Array<{ name: string; bucket: string; link: string }>;
    const { mergeable } = await cliJson<{ mergeable: string }>(
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
    const text = await cliOk(
      "gh",
      ["run", "view", urlName("run", buildId), "--repo", `${owner}/${repo}`, "--log-failed"],
      cwd,
    );
    return tail(text, BUILD_LOG_BYTES);
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

/** The parts of an Azure DevOps PR URL, the names decoded and checked before they reach `az`. */
function azParts(url: string): { org: string; project: string; repo: string; id: string } {
  const match =
    /^(https:\/\/dev\.azure\.com\/[^/]+|https:\/\/[^/]+\.visualstudio\.com)\/([^/]+)\/_git\/([^/]+)\/pullrequest\/(\d+)/.exec(
      url,
    );
  if (!match) throw new FlightdeckError("invalid_state", `URL de PR do Azure inválida: ${url}`);
  const [, org, encodedProject, encodedRepo, id] = match as unknown as [
    string,
    string,
    string,
    string,
    string,
  ];
  // The URL has the names encoded; the API wants them as they are ("Meu%20Projeto" → "Meu Projeto").
  // A %40 decodes to @, which az would take for a file: the names are checked after decoding.
  return {
    org,
    project: urlName("projeto", decodeURIComponent(encodedProject)),
    repo: urlName("repositório", decodeURIComponent(encodedRepo)),
    id,
  };
}

const AZ_CHECK_STATES: Record<string, PrCheck["state"]> = {
  approved: "passing",
  notApplicable: "passing",
  rejected: "failing",
  broken: "failing",
};

interface AzEvaluation {
  status: string;
  configuration: { type: { displayName: string }; settings?: { displayName?: string } };
  context?: { buildId?: number } | null;
}

interface AzRecord {
  type: string;
  name: string;
  result: string | null;
  log: { id: number } | null;
}

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

  /**
   * The builds and policies by the policy evaluations (a preview route of `az devops invoke`;
   * `az repos pr policy list` has no build id), and the conflicts by the PR's merge status.
   */
  async health({ cwd, url }: { cwd: string; url: string }): Promise<PrHealth> {
    const { org, project, id } = azParts(url);
    const pr = await cliJson<{ mergeStatus?: string; repository: { project: { id: string } } }>(
      "az",
      ["repos", "pr", "show", "--id", id, "--output", "json"],
      cwd,
    );
    const { value } = await cliJson<{ value: AzEvaluation[] }>(
      "az",
      [
        "devops",
        "invoke",
        "--area",
        "policy",
        "--resource",
        "evaluations",
        "--route-parameters",
        `project=${project}`,
        "--query-parameters",
        `artifactId=vstfs:///CodeReview/CodeReviewId/${pr.repository.project.id}/${id}`,
        "--org",
        org,
        "--api-version",
        "7.1-preview.1",
        "--output",
        "json",
      ],
      cwd,
    );
    return {
      checks: value.map((evaluation): PrCheck => {
        const buildId = evaluation.context?.buildId;
        return {
          name:
            evaluation.configuration.settings?.displayName ??
            evaluation.configuration.type.displayName,
          state: AZ_CHECK_STATES[evaluation.status] ?? "pending",
          kind: buildId === undefined ? "policy" : "build",
          buildId: buildId === undefined ? null : String(buildId),
        };
      }),
      conflicts: pr.mergeStatus === "conflicts",
    };
  }

  /**
   * The end of the log of each task that failed in the build, from its timeline (`az pipelines
   * runs` has no log subcommand), 16 KB in all.
   */
  async buildLog({
    cwd,
    url,
    buildId,
  }: {
    cwd: string;
    url: string;
    buildId: string;
  }): Promise<string> {
    const { org, project } = azParts(url);
    const route = [
      "--route-parameters",
      `project=${project}`,
      `buildId=${urlName("build", buildId)}`,
    ];
    const { records } = await cliJson<{ records: AzRecord[] }>(
      "az",
      ["devops", "invoke", "--area", "build", "--resource", "timeline", ...route].concat([
        "--org",
        org,
        "--api-version",
        "7.1",
        "--output",
        "json",
      ]),
      cwd,
    );
    const failed = records.filter((r) => r.type === "Task" && r.result === "failed" && r.log);
    const share = Math.floor(BUILD_LOG_BYTES / Math.max(failed.length, 1));
    const parts: string[] = [];
    for (const record of failed) {
      const text = await cliOk(
        "az",
        [
          "devops",
          "invoke",
          "--area",
          "build",
          "--resource",
          "logs",
          ...route,
          `logId=${record.log?.id}`,
          "--org",
          org,
          "--accept-media-type",
          "text/plain",
          "--api-version",
          "7.1",
        ],
        cwd,
      );
      parts.push(`### ${record.name}\n${tail(text, share)}`);
    }
    return parts.join("\n");
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
    const { org, project, repo, id } = azParts(url);
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
              authorAssociation: null,
              authorIdentity: comment.author.uniqueName ?? comment.author.id ?? null,
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
