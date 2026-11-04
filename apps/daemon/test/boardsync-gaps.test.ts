import { describe, expect, test } from "bun:test";
import { BoardSync } from "../src/boardsync/engine.ts";
import { GithubBoards } from "../src/boardsync/github.ts";
import { BoardSyncLoop } from "../src/boardsync/loop.ts";
import { BoardSyncService } from "../src/boardsync/service.ts";
import { BoardSyncStore } from "../src/boardsync/store.ts";
import { newBoard } from "./board-helpers.ts";
import { item } from "./boardsync-contract.ts";
import { BOARD, FakeProvider } from "./boardsync-fake.ts";
import { syncSetup } from "./boardsync-setup.ts";
import { manualTime } from "./time-helpers.ts";

const reasonOf = (run: Promise<unknown>) =>
  run.then(
    () => undefined,
    (error: { reason?: string; params?: Record<string, unknown> }) => ({
      reason: error.reason,
      params: error.params,
    }),
  );

const answer =
  (stdout: string, code = 0, stderr = "") =>
  async () => ({ code, stdout, stderr });

describe("board-sync-gaps: github.ts answers", () => {
  test("a gh failure no rule knows is reported with its first line only", async () => {
    const boards = new GithubBoards({
      gh: answer("", 1, "\n  boom: the network is down  \nsecond line\n"),
    });
    expect(await reasonOf(boards.listBoards())).toEqual({
      reason: "board_sync_failed",
      params: { detail: "boom: the network is down" },
    });
  });

  test("GraphQL errors inside a successful answer are mapped like a failed call", async () => {
    const boards = new GithubBoards({
      gh: answer(
        JSON.stringify({ errors: [{ message: "API rate limit exceeded" }, { message: "x" }] }),
      ),
    });
    expect((await reasonOf(boards.listBoards()))?.reason).toBe("board_sync_rate_limited");
  });

  test("a board listed for the viewer and for an organization shows once", async () => {
    const project = {
      id: "PVT_1",
      title: "Roadmap",
      number: 1,
      url: "https://github.com/orgs/acme/projects/1",
      owner: { login: "acme" },
    };
    const boards = new GithubBoards({
      gh: answer(
        JSON.stringify({
          data: {
            viewer: {
              login: "me",
              projectsV2: { nodes: [project] },
              organizations: { nodes: [{ login: "acme", projectsV2: { nodes: [project] } }] },
            },
          },
        }),
      ),
    });
    expect((await boards.listBoards()).map((b) => b.id)).toEqual(["PVT_1"]);
  });

  test("setStatus with an option the Status field does not have is refused", async () => {
    const field = { data: { node: { field: { id: "F", options: [{ id: "o1", name: "Todo" }] } } } };
    const boards = new GithubBoards({
      gh: async (args) =>
        args[0] === "auth"
          ? {
              code: 0,
              stdout: "Logged in to github.com account me (keyring)\n- Token scopes: 'project'\n",
              stderr: "",
            }
          : { code: 0, stdout: JSON.stringify(field), stderr: "" },
    });
    expect(await reasonOf(boards.setStatus(BOARD.id, "PVTI_1", "nope"))).toEqual({
      reason: "board_sync_option_not_found",
      params: { option: "nope" },
    });
  });
});

describe("board-sync-gaps: the engine", () => {
  test("syncing a project with no linked board is refused with its reason", async () => {
    const s = await syncSetup();
    s.store.unlink(s.project.id);
    expect(await reasonOf(s.sync.syncProject(s.project.id))).toMatchObject({
      reason: "board_sync_not_linked",
    });
  });

  test("a board that lost its Status field clears the mark of a moved card and sends nothing", async () => {
    const s = await syncSetup(true);
    s.provider.items = [item(1, { status: "Todo", updatedAt: "2026-10-01T10:00:00Z" })];
    await s.sync.syncProject(s.project.id);
    const card = s.cards()[0]?.id ?? "";
    s.board.moveCard(card, "review");
    s.provider.hasStatus = false;
    const report = await s.sync.syncProject(s.project.id);
    expect(report.pushed).toBe(0);
    expect(s.provider.setStatusCalls).toEqual([]);
    expect(s.store.externalOf(card).localMovedAt).toBeNull();
  });

  test("an item archived at the provider counts gone once, not at every later sync", async () => {
    const s = await syncSetup();
    s.provider.items = [item(1, { updatedAt: "2026-10-02T10:00:00Z" })];
    await s.sync.syncProject(s.project.id);
    s.provider.items = [item(1, { archived: true, updatedAt: "2026-10-02T11:00:00Z" })];
    expect((await s.sync.syncProject(s.project.id)).gone).toBe(1);
    s.provider.items = [item(1, { archived: true, updatedAt: "2026-10-02T12:00:00Z" })];
    expect((await s.sync.syncProject(s.project.id)).gone).toBe(0);
  });
});

describe("board-sync-gaps: the service", () => {
  async function service() {
    const ctx = newBoard();
    const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
    const store = new BoardSyncStore(ctx.store.db);
    const provider = new FakeProvider();
    const engine = new BoardSync({ board: ctx.board, store, provider });
    const time = manualTime();
    const loop = new BoardSyncLoop({ engine, store, timers: time.timers, clock: time.now });
    const svc = new BoardSyncService({ board: ctx.board, store, provider, engine, loop });
    return { svc, project, provider, stop: () => (loop.stop(), ctx.board.stop()) };
  }

  test("setMap on a board that lost its Status field is refused", async () => {
    const s = await service();
    try {
      await s.svc.link({ projectId: s.project.id, boardId: BOARD.id });
      s.provider.hasStatus = false;
      expect(await reasonOf(s.svc.setMap(s.project.id, { Todo: "backlog", Done: "done" }))).toEqual(
        { reason: "board_sync_field_not_found", params: { field: "Status" } },
      );
    } finally {
      s.stop();
    }
  });

  test("the status still answers when the provider cannot read the Status field", async () => {
    const s = await service();
    try {
      await s.svc.link({ projectId: s.project.id, boardId: BOARD.id });
      s.provider.beforeCall = (method) => {
        if (method === "statusField") throw new Error("down");
      };
      expect(await s.svc.status(s.project.id)).toMatchObject({ linked: true, statusOptions: [] });
    } finally {
      s.stop();
    }
  });

  test("syncNow whose sync failed is refused with the reason it failed for", async () => {
    const s = await service();
    try {
      await s.svc.link({ projectId: s.project.id, boardId: BOARD.id });
      s.provider.beforeCall = (method) => {
        if (method === "pull") throw new Error("down");
      };
      const refused = await reasonOf(s.svc.syncNow(s.project.id));
      expect(refused?.reason).toBeString();
    } finally {
      s.stop();
    }
  });
});
