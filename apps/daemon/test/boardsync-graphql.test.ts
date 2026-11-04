import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { type FakeCli, type FakeRule, installFakeCli } from "../../../scripts/test/fake-cli.ts";
import { GithubBoards } from "../src/boardsync/github.ts";
import type { BoardProvider, ExternalItem } from "../src/boardsync/provider.ts";
import { runGh } from "../src/github/gh.ts";
import { type ContractHarness, item, providerContract } from "./boardsync-contract.ts";
import { BOARD, STATUS_FIELD } from "./boardsync-fake.ts";

setDefaultTimeout(60_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const queryOf = (call: string[]) => call.find((arg) => arg.startsWith("query=")) ?? "";

/** The GraphQL node GitHub answers for an item. */
function node(i: ExternalItem) {
  const content =
    i.content === null
      ? null
      : i.content.kind === "draft"
        ? { __typename: "DraftIssue", title: i.title, body: i.body }
        : {
            __typename: i.content.kind === "issue" ? "Issue" : "PullRequest",
            number: Number(i.id.replace(/\D/g, "")),
            title: i.title,
            body: i.body,
            url: i.url,
            repository: { nameWithOwner: "acme/app" },
            author: { login: "ana" },
            authorAssociation: i.content.external ? "NONE" : "MEMBER",
          };
  return {
    id: i.id,
    isArchived: i.archived,
    updatedAt: i.updatedAt,
    fieldValueByName: i.status ? { name: i.status } : null,
    content,
  };
}

const ok = (data: unknown): Pick<FakeRule, "stdout"> => ({ stdout: JSON.stringify({ data }) });

/** A fake gh that answers like GitHub for one board; state changes are applied between calls. */
function githubHarness(): ContractHarness & { gh: FakeCli; state: { items: ExternalItem[] } } {
  const state = {
    items: [] as ExternalItem[],
    scopes: { read: true, write: true },
    hasStatus: true,
    pageSize: 100,
    applied: 0,
  };
  const gh = installFakeCli("gh", []);
  cleanups.push(gh.restore);

  const rules = (): FakeRule[] => {
    const scopes = [
      "'repo'",
      ...(state.scopes.read ? ["'read:project'"] : []),
      ...(state.scopes.write ? ["'project'"] : []),
    ];
    const status: FakeRule = {
      args: ["auth", "status"],
      stdout: `github.com\n  ✓ Logged in to github.com account octocat (keyring)\n  - Token scopes: ${scopes.join(", ")}\n`,
    };
    const onBoard = `board=${BOARD.id}`;
    const pages = Math.max(1, Math.ceil(state.items.length / state.pageSize));
    const pageRules: FakeRule[] = [];
    for (let page = pages - 1; page >= 0; page -= 1) {
      const slice = state.items.slice(page * state.pageSize, (page + 1) * state.pageSize);
      pageRules.push({
        args: ["api", "graphql"],
        contains: ["items(first", onBoard, ...(page > 0 ? [`cursor=CUR${page}`] : [])],
        ...ok({
          viewer: { login: "octocat" },
          node: {
            items: {
              pageInfo: { hasNextPage: page < pages - 1, endCursor: `CUR${page + 1}` },
              nodes: slice.map(node),
            },
          },
        }),
      });
    }
    return [
      status,
      {
        args: ["api", "graphql"],
        contains: ["updateProjectV2ItemFieldValue", onBoard],
        ...(state.scopes.write
          ? ok({
              updateProjectV2ItemFieldValue: {
                projectV2Item: { updatedAt: new Date().toISOString() },
              },
            })
          : {
              code: 1,
              stderr: "gh: Your token has not been granted the required scopes: [project]\n",
            }),
      },
      {
        args: ["api", "graphql"],
        contains: ["field(name", onBoard],
        ...ok({
          node: {
            field: state.hasStatus
              ? { id: STATUS_FIELD.fieldId, options: STATUS_FIELD.options }
              : null,
          },
        }),
      },
      ...pageRules.sort((a, b) => (b.contains?.length ?? 0) - (a.contains?.length ?? 0)),
      {
        args: ["api", "graphql"],
        contains: ["projectsV2(first"],
        ...ok({
          viewer: {
            login: "octocat",
            projectsV2: {
              nodes: [
                {
                  id: BOARD.id,
                  title: BOARD.title,
                  number: BOARD.number,
                  url: BOARD.url,
                  owner: { login: BOARD.owner },
                },
              ],
            },
            organizations: { nodes: [] },
          },
        }),
      },
      {
        args: ["api", "graphql"],
        code: 1,
        stderr: "GraphQL: Could not resolve to a node with the global id of 'x'.\n",
      },
    ];
  };

  const sync = () => {
    // A mutation the provider sent is applied to the state before the next call is answered.
    const mutations = gh
      .calls()
      .filter((call) => queryOf(call).includes("updateProjectV2ItemFieldValue"));
    for (const call of mutations.slice(state.applied)) {
      const itemId = call.find((arg) => arg.startsWith("item="))?.slice(5);
      const optionId = call.find((arg) => arg.startsWith("option="))?.slice(7);
      const option = STATUS_FIELD.options.find((candidate) => candidate.id === optionId);
      const target = state.items.find((candidate) => candidate.id === itemId);
      if (target && option && state.scopes.write) {
        target.status = option.name;
        target.updatedAt = new Date().toISOString();
      }
    }
    state.applied = mutations.length;
    gh.respond(rules());
  };
  gh.respond(rules());

  const inner = new GithubBoards({ gh: runGh });
  const provider: BoardProvider = {
    kind: inner.kind,
    scopes: () => (sync(), inner.scopes()),
    listBoards: () => (sync(), inner.listBoards()),
    statusField: (id) => (sync(), inner.statusField(id)),
    pull: (id, since) => (sync(), inner.pull(id, since)),
    setStatus: async (id, itemId, optionId) => {
      sync();
      const result = await inner.setStatus(id, itemId, optionId);
      sync();
      return result;
    },
  };
  return {
    provider,
    boardId: BOARD.id,
    conditional: false,
    gh,
    state,
    seed: (items) => {
      state.items = items.map((entry) => ({ ...entry }));
      sync();
    },
    setScopes: (scopes) => {
      state.scopes = scopes;
      sync();
    },
    setHasStatus: (has) => {
      state.hasStatus = has;
      sync();
    },
    setPageSize: (size) => {
      state.pageSize = size;
      sync();
    },
    mutations: () =>
      gh.calls().filter((call) => queryOf(call).includes("updateProjectV2ItemFieldValue")).length,
  };
}

providerContract("the GitHub provider over a fake gh", githubHarness);

const reasonOf = (run: Promise<unknown>) =>
  run.then(
    () => undefined,
    (error: { reason?: string; params?: Record<string, unknown> }) => ({
      reason: error.reason,
      params: error.params,
    }),
  );

describe("board-graphql: what goes to gh and how its answers are read", () => {
  test("the query text is constant and every value is a variable of its own", async () => {
    const h = githubHarness();
    h.seed([item(1)]);
    await h.provider.pull(h.boardId);
    const call = h.gh.calls().find((c) => queryOf(c).includes("items(first"));
    expect(call?.slice(0, 3)).toEqual(["api", "graphql", "-f"]);
    expect(queryOf(call ?? [])).not.toContain(BOARD.id);
    expect(call).toContain(`board=${BOARD.id}`);
    // Another board id is a different variable, the same text.
    await reasonOf(h.provider.pull("PVT_other"));
    const queries = h.gh
      .calls()
      .filter((c) => queryOf(c).includes("items(first"))
      .map(queryOf);
    expect(new Set(queries).size).toBe(1);
  });

  test("an id with anything but letters, digits, _ = and - is refused before gh runs", async () => {
    const h = githubHarness();
    const before = h.gh.calls().length;
    for (const id of ["", "x; drop", "a b", "$(x)", "-f query=x"]) {
      expect((await reasonOf(h.provider.pull(id)))?.reason).toBe("board_not_found");
    }
    expect(h.gh.calls().length).toBe(before);
  });

  test("a board past the page cap is read up to the cap and says it was truncated", async () => {
    const h = githubHarness();
    h.setPageSize(100);
    h.seed(Array.from({ length: 2050 }, (_, i) => item(i + 1)));
    const pulled = await h.provider.pull(h.boardId);
    expect(pulled.items).toHaveLength(2000);
    expect(pulled.truncated).toBe(true);
  });

  test("a redacted item is link-only content: null, counted", async () => {
    const h = githubHarness();
    h.seed([item(1, { content: null })]);
    const pulled = await h.provider.pull(h.boardId);
    expect(pulled.items[0]?.content).toBeNull();
    expect(pulled.redacted).toBe(1);
  });

  test("an issue's ref and its third-party flag come from the repository and the author", async () => {
    const h = githubHarness();
    h.seed([
      item(4, { content: { kind: "issue", ref: "github:acme/app#4", external: true } }),
      item(5, { content: { kind: "pull_request", ref: "github:acme/app#5", external: false } }),
    ]);
    const pulled = await h.provider.pull(h.boardId);
    expect(pulled.items.map((i) => [i.content?.kind, i.content?.ref, i.content?.external])).toEqual(
      [
        ["issue", "github:acme/app#4", true],
        ["pull_request", "github:acme/app#5", false],
      ],
    );
  });

  test("errors map to reasons: missing scope, rate limit, no Status field, gh missing", async () => {
    const h = githubHarness();
    h.seed([item(1)]);
    h.gh.respond([
      {
        args: ["api", "graphql"],
        code: 1,
        stderr:
          "gh: Your token has not been granted the required scopes to execute this query. [read:project]\n",
      },
    ]);
    const direct = new GithubBoards({ gh: runGh });
    expect(await reasonOf(direct.pull(BOARD.id))).toEqual({
      reason: "board_sync_scope_missing",
      params: { scope: "read:project" },
    });
    h.gh.respond([
      {
        args: ["api", "graphql"],
        code: 1,
        stderr: "GraphQL: API rate limit already exceeded for user ID 1.\n",
      },
    ]);
    expect((await reasonOf(direct.pull(BOARD.id)))?.reason).toBe("board_sync_rate_limited");
    h.setHasStatus(false);
    expect(await reasonOf(h.provider.setStatus(BOARD.id, "PVTI_1", "o4"))).toEqual({
      reason: "board_sync_field_not_found",
      params: { field: "Status" },
    });
    expect((await reasonOf(new GithubBoards({ gh: async () => null }).listBoards()))?.reason).toBe(
      "gh_missing",
    );
  });
});
