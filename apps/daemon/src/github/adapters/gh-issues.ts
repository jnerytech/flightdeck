/**
 * Issue #1612: GitHub issues through `gh`, the only place the issues domain runs it. It matches the
 * issues domain's `IssueProvider` shape without importing it, so the github domain does not depend
 * on the issues domain. Looked up on the PATH of the moment, so the tests put fakes there.
 */
import type { Issue } from "@flightdeck/protocol";
import { z } from "zod";
import { checkedId, cli, cliJsonWith, cliOk, ISSUE_LIMIT } from "../../pr/index.ts";

/** Search of the issues assigned to you and still open. */
const GITHUB_DEFAULT_SEARCH = "assignee:@me is:open";

/** GitHub authors whose content is yours: you, and people with write access to the repository. */
export const TRUSTED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
export const GH_FIELDS = "number,title,body,url,author,labels,createdAt,authorAssociation";

/** One issue as `gh issue list|view --json GH_FIELDS` prints it. */
export const GhIssueRow = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string().nullish(),
  url: z.string(),
  author: z.object({ login: z.string().optional() }).nullish(),
  labels: z.array(z.object({ name: z.string() })).optional(),
  createdAt: z.string(),
  authorAssociation: z.string().optional(),
});
export type GhIssue = z.infer<typeof GhIssueRow>;

export class GithubIssues {
  constructor(readonly repo: string) {}

  refOf(id: string): string {
    return `github:${this.repo}#${id}`;
  }

  async list(cwd: string, query?: string): Promise<Issue[]> {
    const issues = await cliJsonWith(
      z.array(GhIssueRow),
      "gh",
      [
        "issue",
        "list",
        "--search",
        query ?? GITHUB_DEFAULT_SEARCH,
        "--json",
        GH_FIELDS,
        "--limit",
        String(ISSUE_LIMIT),
      ],
      cwd,
    );
    const me = await this.me(cwd);
    return issues.map((issue) => this.toIssue(issue, me));
  }

  async get(cwd: string, id: string): Promise<Issue> {
    const issue = await cliJsonWith(
      GhIssueRow,
      "gh",
      ["issue", "view", checkedId(id), "--json", GH_FIELDS],
      cwd,
    );
    return this.toIssue(issue, await this.me(cwd));
  }

  async comment(cwd: string, id: string, text: string): Promise<void> {
    await cliOk("gh", ["issue", "comment", checkedId(id), "--body", text], cwd);
  }

  /** Your login, when `gh` can tell. */
  private async me(cwd: string): Promise<string | null> {
    const result = await cli("gh", ["api", "user", "--jq", ".login"], cwd);
    return result.code === 0 ? result.stdout.trim().toLowerCase() || null : null;
  }

  toIssue(issue: GhIssue, me: string | null): Issue {
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
