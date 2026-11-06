/**
 * Phase 38: GitHub Projects (v2) as a `BoardProvider`, through the host's `gh api graphql`: the
 * daemon holds no token. Query text is constant and every value goes as a variable.
 */
import { FlightdeckError } from "../errors.ts";
import type { GhResult, GhRunner } from "../github/gh.ts";
import { githubStatus } from "../github/status.ts";
import { TRUSTED_ASSOCIATIONS } from "../issues/providers.ts";
import type {
  BoardProvider,
  ExternalBoard,
  ExternalItem,
  PullResult,
  StatusField,
} from "./provider.ts";

export interface GithubBoardsOptions {
  gh: GhRunner;
}

const PAGE_CAP = 20;
const STATUS_FIELD_NAME = "Status";
const BOARD_ID = /^[A-Za-z0-9_=-]+$/;

const OWNER = "owner { ... on User { login } ... on Organization { login } }";
const PROJECT = `id title number url ${OWNER}`;

const LIST_QUERY = `query { viewer { login projectsV2(first: 50) { nodes { ${PROJECT} } } organizations(first: 20) { nodes { login projectsV2(first: 50) { nodes { ${PROJECT} } } } } } }`;

// The field's name is a variable too: a query with no quote or newline crosses a Windows .cmd shim.
const FIELD_QUERY =
  "query($board: ID!, $field: String!) { node(id: $board) { ... on ProjectV2 { field(name: $field) { ... on ProjectV2SingleSelectField { id options { id name } } } } } }";

const PULL_QUERY = `query($board: ID!, $cursor: String, $field: String!) { viewer { login } node(id: $board) { ... on ProjectV2 { items(first: 100, after: $cursor) { pageInfo { hasNextPage endCursor } nodes { id isArchived updatedAt fieldValueByName(name: $field) { ... on ProjectV2ItemFieldSingleSelectValue { name } } content { __typename ... on Issue { number title body url repository { nameWithOwner } author { login } authorAssociation } ... on PullRequest { number title body url repository { nameWithOwner } author { login } authorAssociation } ... on DraftIssue { title body } } } } } } }`;

const SET_QUERY =
  "mutation($board: ID!, $item: ID!, $field: ID!, $option: String!) { updateProjectV2ItemFieldValue(input: { projectId: $board, itemId: $item, fieldId: $field, value: { singleSelectOptionId: $option } }) { projectV2Item { updatedAt } } }";

const refuse = (
  reason: string,
  message: string,
  params?: Record<string, string | number>,
  code: "invalid_state" | "bad_request" = "invalid_state",
) => new FlightdeckError(code, message, reason, params);

interface GhNode {
  id: string;
  isArchived: boolean;
  updatedAt: string;
  fieldValueByName: { name: string } | null;
  content: {
    __typename: string;
    number?: number;
    title: string;
    body: string | null;
    url?: string;
    repository?: { nameWithOwner: string };
    author?: { login?: string } | null;
    authorAssociation?: string;
  } | null;
}

/** The refusal a gh failure means; what it said is never repeated beyond its last line. */
function failure(result: GhResult): FlightdeckError {
  const text = `${result.stderr}\n${result.stdout}`;
  if (/required scopes?/i.test(text) || /INSUFFICIENT_SCOPES/.test(text)) {
    const scope = /\[([^\]]+)\]/.exec(text)?.[1]?.split(",").pop()?.trim() ?? "project";
    return refuse("board_sync_scope_missing", `the GitHub login lacks the ${scope} scope`, {
      scope,
    });
  }
  if (/rate limit/i.test(text)) {
    const resetAt = new Date(Date.now() + 60_000).toISOString();
    return refuse("board_sync_rate_limited", "GitHub's rate limit was reached", { resetAt });
  }
  if (/could not resolve to a node|not found/i.test(text)) {
    return refuse("board_not_found", "the board was not found, or this login cannot see it");
  }
  const detail =
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .shift()
      ?.slice(0, 300) ?? "";
  return refuse("board_sync_failed", `gh could not reach the board: ${detail}`, { detail });
}

export class GithubBoards implements BoardProvider {
  readonly kind = "github-projects";

  constructor(private readonly opts: GithubBoardsOptions) {}

  /** `gh api graphql` with the constant query and each value as a variable of its own. */
  private async graphql<T>(query: string, variables: Record<string, string> = {}): Promise<T> {
    const args = ["api", "graphql", "-f", `query=${query}`];
    for (const [name, value] of Object.entries(variables)) args.push("-f", `${name}=${value}`);
    const result = await this.opts.gh(args);
    if (!result) throw refuse("gh_missing", "gh is not installed on this host");
    if (result.code !== 0) throw failure(result);
    const body = JSON.parse(result.stdout || "{}") as {
      data?: T;
      errors?: Array<{ message: string }>;
    };
    if (body.errors?.length) {
      throw failure({ code: 1, stdout: "", stderr: body.errors.map((e) => e.message).join("\n") });
    }
    return body.data as T;
  }

  private checkBoard(boardId: string): void {
    if (!BOARD_ID.test(boardId)) throw refuse("board_not_found", "the board id is not valid");
  }

  async scopes(): Promise<{ read: boolean; write: boolean }> {
    const status = await githubStatus(this.opts.gh);
    if (!status.installed) throw refuse("gh_missing", "gh is not installed on this host");
    if (!status.loggedIn) throw refuse("gh_logged_out", "gh is not signed in to GitHub");
    // A token that does not list its scopes (fine-grained): the calls themselves will say.
    if (status.scopes.length === 0) return { read: true, write: true };
    const write = status.scopes.includes("project");
    return { read: write || status.scopes.includes("read:project"), write };
  }

  async listBoards(): Promise<ExternalBoard[]> {
    type Project = {
      id: string;
      title: string;
      number: number;
      url: string;
      owner: { login?: string };
    };
    const data = await this.graphql<{
      viewer: {
        projectsV2: { nodes: Project[] };
        organizations: { nodes: Array<{ projectsV2: { nodes: Project[] } }> };
      };
    }>(LIST_QUERY);
    const all = [
      ...data.viewer.projectsV2.nodes,
      ...data.viewer.organizations.nodes.flatMap((org) => org.projectsV2.nodes),
    ];
    const seen = new Set<string>();
    return all.flatMap((project) =>
      seen.has(project.id)
        ? []
        : (seen.add(project.id),
          [
            {
              id: project.id,
              title: project.title,
              owner: project.owner.login ?? "",
              number: project.number,
              url: project.url,
            },
          ]),
    );
  }

  async statusField(boardId: string): Promise<StatusField | null> {
    this.checkBoard(boardId);
    const data = await this.graphql<{
      node: { field: { id: string; options: Array<{ id: string; name: string }> } | null } | null;
    }>(FIELD_QUERY, { board: boardId, field: STATUS_FIELD_NAME });
    if (!data.node) throw refuse("board_not_found", "the board was not found");
    return data.node.field
      ? { fieldId: data.node.field.id, options: data.node.field.options }
      : null;
  }

  async pull(boardId: string, _since?: string): Promise<PullResult> {
    this.checkBoard(boardId);
    const items: ExternalItem[] = [];
    let cursor: string | undefined;
    let truncated = false;
    let redacted = 0;
    for (let page = 0; page < PAGE_CAP + 1; page += 1) {
      const data =
        await /* NOSONAR: paging: each page is asked for with the cursor of the one before */ this.graphql<{
          viewer: { login: string };
          node: {
            items: {
              pageInfo: { hasNextPage: boolean; endCursor: string | null };
              nodes: GhNode[];
            };
          } | null;
        }>(PULL_QUERY, { board: boardId, field: STATUS_FIELD_NAME, ...(cursor ? { cursor } : {}) });
      if (!data.node) throw refuse("board_not_found", "the board was not found");
      if (page === PAGE_CAP) {
        truncated = true;
        break;
      }
      const me = data.viewer.login.toLowerCase();
      for (const raw of data.node.items.nodes) {
        const mapped = toItem(raw, me);
        if (mapped.content === null) redacted += 1;
        items.push(mapped);
      }
      if (!data.node.items.pageInfo.hasNextPage) break;
      cursor = data.node.items.pageInfo.endCursor ?? undefined;
    }
    // GitHub's conditional requests are not confirmed for this API: every pull reads every page.
    const digest = JSON.stringify(items.map((i) => [i.id, i.status, i.updatedAt, i.title]));
    return { items, cursor: String(Bun.hash(digest)), notModified: false, truncated, redacted };
  }

  async setStatus(
    boardId: string,
    itemId: string,
    optionId: string,
  ): Promise<{ updatedAt: string }> {
    this.checkBoard(boardId);
    // Before anything is sent: a login without the write scope never reaches the mutation.
    if (!(await this.scopes()).write) {
      throw refuse("board_sync_scope_missing", "the GitHub login lacks the project scope", {
        scope: "project",
      });
    }
    for (const id of [itemId, optionId]) {
      if (!BOARD_ID.test(id)) throw refuse("board_sync_option_not_found", "the id is not valid");
    }
    const field = await this.statusField(boardId);
    if (!field) {
      throw refuse("board_sync_field_not_found", "the board has no Status field", {
        field: "Status",
      });
    }
    if (!field.options.some((option) => option.id === optionId)) {
      throw refuse("board_sync_option_not_found", "the board has no such Status option", {
        option: optionId,
      });
    }
    const data = await this.graphql<{
      updateProjectV2ItemFieldValue: { projectV2Item: { updatedAt: string } };
    }>(SET_QUERY, { board: boardId, item: itemId, field: field.fieldId, option: optionId });
    return { updatedAt: data.updateProjectV2ItemFieldValue.projectV2Item.updatedAt };
  }
}

function toItem(raw: GhNode, me: string): ExternalItem {
  const content = raw.content;
  const base = {
    id: raw.id,
    status: raw.fieldValueByName?.name ?? null,
    updatedAt: raw.updatedAt,
    archived: raw.isArchived,
  };
  if (!content) return { ...base, url: "", title: "", body: "", content: null };
  if (content.__typename === "DraftIssue") {
    return {
      ...base,
      url: "",
      title: content.title,
      body: content.body ?? "",
      content: { kind: "draft" },
    };
  }
  const author = (content.author?.login ?? "").toLowerCase();
  const external =
    author !== me && !TRUSTED_ASSOCIATIONS.has((content.authorAssociation ?? "").toUpperCase());
  return {
    ...base,
    url: content.url ?? "",
    title: content.title,
    body: content.body ?? "",
    content: {
      kind: content.__typename === "PullRequest" ? "pull_request" : "issue",
      ref: `github:${content.repository?.nameWithOwner ?? ""}#${content.number ?? ""}`,
      external,
    },
  };
}
