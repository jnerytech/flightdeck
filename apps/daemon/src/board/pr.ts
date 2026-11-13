import type { PrProviderKind, PrState } from "@flightdeck/protocol";
import { inSequence } from "@flightdeck/protocol";
import { GithubCli } from "../github/index.ts";
import { FlightdeckError } from "../kernel/index.ts";
import {
  azureDetails,
  BUILD_LOG_BYTES,
  CliProvider,
  type CreatePr,
  type PrCheck,
  type PrComment,
  type PrHealth,
  type PrProvider,
  type PrStatus,
  summarize,
  tail,
  urlName,
} from "../pr/index.ts";
import {
  AzEvaluations,
  AzPolicies,
  AzPr,
  AzPrHealth,
  AzPrList,
  AzPrStatus,
  AzThreads,
  AzTimeline,
} from "./az-json.ts";

const AZ_RESOLVED = new Set(["fixed", "closed", "wontFix", "byDesign"]);

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
  if (!match)
    throw new FlightdeckError("invalid_state", `invalid Azure PR URL: ${url}`, "pr_url_invalid", {
      provider: "Azure",
      url,
    });
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

/** Azure DevOps through `az repos` (organization and project detected from the remote). */
export class AzureDevOpsCli extends CliProvider implements PrProvider {
  async create(opts: CreatePr): Promise<string> {
    const existing = await this.url(opts);
    if (existing) return existing;
    const { cwd, base, head, title, body } = opts;
    const pr = await this.jsonWith(
      AzPr,
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
    const pr = await this.jsonWith(
      AzPrStatus,
      "az",
      ["repos", "pr", "show", "--id", id, "--output", "json"],
      cwd,
    );
    const policies = await this.jsonWith(
      AzPolicies,
      "az",
      ["repos", "pr", "policy", "list", "--id", id, "--output", "json"],
      cwd,
    );
    const checks = policies.map(({ status }) => {
      if (AZ_FAIL.has(status)) return "failing" as const;
      return AZ_PASS.has(status) ? ("passing" as const) : ("pending" as const);
    });
    return {
      state: AZ_STATES[pr.status] ?? "open",
      checks: summarize(checks),
      ...azureDetails(pr),
    };
  }

  /**
   * The builds and policies by the policy evaluations (a preview route of `az devops invoke`;
   * `az repos pr policy list` has no build id), and the conflicts by the PR's merge status.
   */
  async health({ cwd, url }: { cwd: string; url: string }): Promise<PrHealth> {
    const { org, project, id } = azParts(url);
    const pr = await this.jsonWith(
      AzPrHealth,
      "az",
      ["repos", "pr", "show", "--id", id, "--output", "json"],
      cwd,
    );
    const { value } = await this.jsonWith(
      AzEvaluations,
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
          kind: buildId == null ? "policy" : "build",
          buildId: buildId == null ? null : String(buildId),
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
    const { records } = await this.jsonWith(
      AzTimeline,
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
    await inSequence(failed, async (record) => {
      const text = await this.ok(
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
    });
    return parts.join("\n");
  }

  async url({ cwd, head }: { cwd: string; head: string }): Promise<string | null> {
    const prs = await this.jsonWith(
      AzPrList,
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
    const { value } = await this.jsonWith(
      AzThreads,
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
              path: thread.threadContext?.filePath?.replace(/^\//, "") ?? null,
              line: thread.threadContext?.rightFileStart?.line ?? null,
              author: comment.author.displayName,
              authorAssociation: null,
              authorIdentity: comment.author.uniqueName ?? comment.author.id ?? null,
              body: comment.content ?? "",
              resolved: AZ_RESOLVED.has(thread.status ?? ""),
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
