/**
 * Issues through the CLIs the PR providers use (phase 4): `gh` for GitHub, `az boards` for Azure
 * DevOps. Both are looked up on the PATH of the moment, so the tests put fakes there.
 */
import type { Issue } from "@flightdeck/protocol";
import { z } from "zod";
import { GithubIssues } from "../github/index.ts";
import { checkedId, cli, cliJsonWith, cliOk, ISSUE_LIMIT } from "../pr/index.ts";
import {
  AZURE_DEFAULT_WIQL,
  type AzIdentity,
  type AzWorkItem,
  AzWorkItemRow,
  htmlToText,
  textOf,
} from "./domain/az-work-item.ts";
import { parseIssueRef } from "./domain/issue-ref.ts";

export interface IssueProvider {
  /** `github:owner/repo#id` or `azure:org/project#id`. */
  refOf(id: string): string;
  list(cwd: string, query?: string): Promise<Issue[]>;
  get(cwd: string, id: string): Promise<Issue>;
  comment(cwd: string, id: string, text: string): Promise<void>;
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
    const items = await cliJsonWith(
      z.array(AzWorkItemRow),
      "az",
      ["boards", "query", "--wiql", query ?? AZURE_DEFAULT_WIQL, ...this.scope, "--output", "json"],
      cwd,
    );
    const me = await this.me(cwd);
    return Promise.all(
      items.slice(0, ISSUE_LIMIT).map(async (item) => {
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
        checkedId(id),
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
    return cliJsonWith(
      AzWorkItemRow,
      "az",
      ["boards", "work-item", "show", "--id", checkedId(id), ...this.scope, "--output", "json"],
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
        ? { displayName: created, uniqueName: /<(.+)>/.exec(created)?.[1] ?? created } // NOSONAR: one short identity string from az, not text of any length
        : (created ?? {});
    const unique = (identity.uniqueName ?? "").toLowerCase();
    return {
      ref: this.refOf(String(id)),
      id: String(id),
      title: textOf(fields["System.Title"]),
      body: htmlToText(textOf(fields["System.Description"])),
      url: `https://dev.azure.com/${this.coords.org}/${encodeURIComponent(this.coords.project)}/_workitems/edit/${id}`,
      author: identity.displayName ?? identity.uniqueName ?? "",
      labels: textOf(fields["System.Tags"])
        .split(";")
        .map((tag) => tag.trim())
        .filter((tag) => tag !== ""),
      external: me === null || unique !== me,
      createdAt: textOf(fields["System.CreatedDate"]),
    };
  }
}

/** The provider an existing reference belongs to, from the reference itself. */
export function providerOfRef(ref: string): IssueProvider | null {
  const parsed = parseIssueRef(ref);
  if (!parsed) return null;
  if (parsed.provider === "github") return new GithubIssues(parsed.scope);
  const [org, ...project] = parsed.scope.split("/");
  return org && project.length > 0 ? new AzureIssues({ org, project: project.join("/") }) : null;
}
