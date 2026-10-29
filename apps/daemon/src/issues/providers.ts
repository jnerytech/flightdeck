/**
 * Issues through the CLIs the PR providers use (phase 4): `gh` for GitHub, `az boards` for Azure
 * DevOps. Both are looked up on the PATH of the moment, so the tests put fakes there.
 */
import type { Issue } from "@flightdeck/protocol";
import { cli, cliJson, cliOk } from "../board/pr.ts";

/** Search of the issues assigned to you and still open. */
export const GITHUB_DEFAULT_SEARCH = "assignee:@me is:open";
/** Active work items assigned to you, with the fields an issue needs. */
export const AZURE_DEFAULT_WIQL =
  "SELECT [System.Id], [System.Title], [System.Description], [System.CreatedBy], " +
  "[System.CreatedDate], [System.Tags] FROM WorkItems WHERE [System.AssignedTo] = @Me " +
  "AND [System.State] NOT IN ('Closed','Done','Removed') AND [System.TeamProject] = @project " +
  "ORDER BY [System.ChangedDate] DESC";
const LIMIT = 50;

export interface IssueProvider {
  /** `github:owner/repo#id` or `azure:org/project#id`. */
  refOf(id: string): string;
  list(cwd: string, query?: string): Promise<Issue[]>;
  get(cwd: string, id: string): Promise<Issue>;
  comment(cwd: string, id: string, text: string): Promise<void>;
}

/** GitHub authors whose content is yours: you, and people with write access to the repository. */
const TRUSTED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const GH_FIELDS = "number,title,body,url,author,labels,createdAt,authorAssociation";

interface GhIssue {
  number: number;
  title: string;
  body: string | null;
  url: string;
  author?: { login?: string } | null;
  labels?: Array<{ name: string }>;
  createdAt: string;
  authorAssociation?: string;
}

export class GithubIssues implements IssueProvider {
  constructor(readonly repo: string) {}

  refOf(id: string): string {
    return `github:${this.repo}#${id}`;
  }

  async list(cwd: string, query?: string): Promise<Issue[]> {
    const issues = await cliJson<GhIssue[]>(
      "gh",
      [
        "issue",
        "list",
        "--search",
        query ?? GITHUB_DEFAULT_SEARCH,
        "--json",
        GH_FIELDS,
        "--limit",
        String(LIMIT),
      ],
      cwd,
    );
    const me = await this.me(cwd);
    return issues.map((issue) => this.toIssue(issue, me));
  }

  async get(cwd: string, id: string): Promise<Issue> {
    const issue = await cliJson<GhIssue>("gh", ["issue", "view", id, "--json", GH_FIELDS], cwd);
    return this.toIssue(issue, await this.me(cwd));
  }

  async comment(cwd: string, id: string, text: string): Promise<void> {
    await cliOk("gh", ["issue", "comment", id, "--body", text], cwd);
  }

  /** Your login, when `gh` can tell. */
  private async me(cwd: string): Promise<string | null> {
    const result = await cli("gh", ["api", "user", "--jq", ".login"], cwd);
    return result.code === 0 ? result.stdout.trim().toLowerCase() || null : null;
  }

  private toIssue(issue: GhIssue, me: string | null): Issue {
    const author = issue.author?.login ?? "";
    const yours = me !== null && author.toLowerCase() === me;
    return {
      ref: this.refOf(String(issue.number)),
      id: String(issue.number),
      title: issue.title,
      body: issue.body ?? "",
      url: issue.url,
      author,
      labels: (issue.labels ?? []).map((label) => label.name),
      external: !yours && !TRUSTED_ASSOCIATIONS.has((issue.authorAssociation ?? "").toUpperCase()),
      createdAt: issue.createdAt,
    };
  }
}

interface AzIdentity {
  displayName?: string;
  uniqueName?: string;
}

interface AzWorkItem {
  id: number;
  fields: Record<string, unknown>;
}

/** The text of the HTML Azure DevOps keeps in descriptions. */
function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
    .trim();
}

export class AzureIssues implements IssueProvider {
  private readonly scope: string[];

  constructor(readonly coords: { org: string; project: string }) {
    this.scope = ["--org", `https://dev.azure.com/${coords.org}`, "--project", coords.project];
  }

  refOf(id: string): string {
    return `azure:${this.coords.org}/${this.coords.project}#${id}`;
  }

  async list(cwd: string, query?: string): Promise<Issue[]> {
    const items = await cliJson<AzWorkItem[]>(
      "az",
      ["boards", "query", "--wiql", query ?? AZURE_DEFAULT_WIQL, ...this.scope, "--output", "json"],
      cwd,
    );
    const me = await this.me(cwd);
    return Promise.all(
      items.slice(0, LIMIT).map(async (item) => {
        // A WIQL of your own may not select the fields an issue needs.
        const full = item.fields["System.Title"] ? item : await this.show(cwd, String(item.id));
        return this.toIssue(full, me);
      }),
    );
  }

  async get(cwd: string, id: string): Promise<Issue> {
    return this.toIssue(await this.show(cwd, id), await this.me(cwd));
  }

  async comment(cwd: string, id: string, text: string): Promise<void> {
    await cliOk(
      "az",
      [
        "boards",
        "work-item",
        "update",
        "--id",
        id,
        "--discussion",
        text,
        ...this.scope,
        "--output",
        "json",
      ],
      cwd,
    );
  }

  private show(cwd: string, id: string): Promise<AzWorkItem> {
    return cliJson<AzWorkItem>(
      "az",
      ["boards", "work-item", "show", "--id", id, ...this.scope, "--output", "json"],
      cwd,
    );
  }

  /** Your identity in `az`; without it every author counts as third party. */
  private async me(cwd: string): Promise<string | null> {
    const result = await cli(
      "az",
      ["account", "show", "--query", "user.name", "--output", "tsv"],
      cwd,
    );
    return result.code === 0 ? result.stdout.trim().toLowerCase() || null : null;
  }

  private toIssue({ id, fields }: AzWorkItem, me: string | null): Issue {
    const created = fields["System.CreatedBy"] as AzIdentity | string | undefined;
    // Older az versions print "Name <email>" instead of the identity object.
    const identity: AzIdentity =
      typeof created === "string"
        ? { displayName: created, uniqueName: /<(.+)>/.exec(created)?.[1] ?? created }
        : (created ?? {});
    const unique = (identity.uniqueName ?? "").toLowerCase();
    return {
      ref: this.refOf(String(id)),
      id: String(id),
      title: String(fields["System.Title"] ?? ""),
      body: htmlToText(String(fields["System.Description"] ?? "")),
      url: `https://dev.azure.com/${this.coords.org}/${encodeURIComponent(this.coords.project)}/_workitems/edit/${id}`,
      author: identity.displayName ?? identity.uniqueName ?? "",
      labels: String(fields["System.Tags"] ?? "")
        .split(";")
        .map((tag) => tag.trim())
        .filter((tag) => tag !== ""),
      external: me === null || unique !== me,
      createdAt: String(fields["System.CreatedDate"] ?? ""),
    };
  }
}

/** The parts of a `github:owner/repo#n` or `azure:org/project#id` reference. */
export function parseIssueRef(
  ref: string,
): { provider: "github" | "azure"; scope: string; id: string } | null {
  const match = /^(github|azure):(.+)#([^#]+)$/.exec(ref);
  return match
    ? {
        provider: match[1] as "github" | "azure",
        scope: match[2] as string,
        id: match[3] as string,
      }
    : null;
}

/** The provider an existing reference belongs to, from the reference itself. */
export function providerOfRef(ref: string): IssueProvider | null {
  const parsed = parseIssueRef(ref);
  if (!parsed) return null;
  if (parsed.provider === "github") return new GithubIssues(parsed.scope);
  const [org, ...project] = parsed.scope.split("/");
  return org && project.length > 0 ? new AzureIssues({ org, project: project.join("/") }) : null;
}

/** What a PR says so the provider links it to the issue and closes it on merge. */
export function closingLine(ref: string): string | null {
  const parsed = parseIssueRef(ref);
  if (!parsed) return null;
  return parsed.provider === "github" ? `Fixes #${parsed.id}` : `AB#${parsed.id}`;
}
