import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as protocol from "@flightdeck/protocol";
import { BoardSync } from "../src/boardsync/engine.ts";
import { BoardSyncLoop } from "../src/boardsync/loop.ts";
import { BoardSyncService } from "../src/boardsync/service.ts";
import { BoardSyncStore } from "../src/boardsync/store.ts";
import { type RunningServer, startServer } from "../src/server.ts";
import { newBoard } from "./board-helpers.ts";
import { item } from "./boardsync-contract.ts";
import { FakeProvider } from "./boardsync-fake.ts";
import { newManager, poll } from "./helpers.ts";
import { manualTime } from "./time-helpers.ts";

setDefaultTimeout(30_000);

const TOKEN = "boardsync-protocol-token-0123456789";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function ask(server: RunningServer, type: string, payload: object) {
  const ws = new WebSocket(server.url);
  const acks: protocol.Ack[] = [];
  ws.addEventListener("message", (m) => {
    const msg = protocol.parseServerMessage(String(m.data));
    if (msg.type === "ack") acks.push(msg);
  });
  await new Promise((r) => ws.addEventListener("open", r));
  ws.send(JSON.stringify({ id: "1", type: "hello", payload: { token: TOKEN, client: "t" } }));
  ws.send(JSON.stringify({ id: "2", type, payload }));
  const ack = await poll(() => acks.find((a) => a.id === "2"), 10_000);
  ws.close();
  return ack;
}

async function host(withSync: boolean) {
  const ctx = newBoard();
  cleanups.push(() => ctx.board.stop());
  const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
  const store = new BoardSyncStore(ctx.store.db);
  const provider = new FakeProvider();
  provider.items = [item(1, { status: "In Progress" })];
  const engine = new BoardSync({ board: ctx.board, store, provider });
  const time = manualTime();
  const loop = new BoardSyncLoop({ engine, store, timers: time.timers, clock: time.now });
  cleanups.push(() => loop.stop());
  const service = new BoardSyncService({ board: ctx.board, store, provider, engine, loop });
  const server = startServer({
    manager: newManager().manager,
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [ctx.root],
    board: ctx.board,
    ...(withSync ? { boardsync: service } : {}),
  });
  cleanups.push(() => server.stop());
  return { ...ctx, project, store, provider, server };
}

describe("board-sync-protocol: the boardsync commands", () => {
  test("payloads: strict objects, a map of columns, push with a confirm", () => {
    const parse = (type: string, payload: object) =>
      protocol.Command.safeParse({ id: "1", type, payload }).success;
    expect(parse("boardsync.boards", {})).toBe(true);
    expect(parse("boardsync.link", { projectId: "p", boardId: "PVT_1" })).toBe(true);
    expect(
      parse("boardsync.link", { projectId: "p", boardId: "PVT_1", columnMap: { Todo: "backlog" } }),
    ).toBe(true);
    expect(
      parse("boardsync.link", { projectId: "p", boardId: "PVT_1", columnMap: { Todo: "x" } }),
    ).toBe(false);
    expect(parse("boardsync.link", { projectId: "p" })).toBe(false);
    expect(parse("boardsync.unlink", { projectId: "p" })).toBe(true);
    expect(parse("boardsync.setMap", { projectId: "p", columnMap: { Done: "done" } })).toBe(true);
    expect(parse("boardsync.setPush", { projectId: "p", push: true, confirm: true })).toBe(true);
    expect(parse("boardsync.setPush", { projectId: "p", push: true })).toBe(false);
    expect(parse("boardsync.status", { projectId: "p" })).toBe(true);
    expect(parse("boardsync.syncNow", { projectId: "p", extra: 1 })).toBe(false);
    expect(parse("boardsync.log", { cardId: "c" })).toBe(true);
  });

  test("boards, link (which syncs once), status, syncNow and the log answer", async () => {
    const h = await host(true);
    const boards = await ask(h.server, "boardsync.boards", {});
    expect(boards?.ok && (boards.data as { boards: Array<{ id: string }> }).boards[0]?.id).toBe(
      "PVT_board1",
    );
    const linked = await ask(h.server, "boardsync.link", {
      projectId: h.project.id,
      boardId: "PVT_board1",
    });
    expect(linked?.ok && linked.data).toMatchObject({
      linked: true,
      boardId: "PVT_board1",
      push: false,
      lastError: null,
      columnMap: {
        Todo: "backlog",
        "In Progress": "in_progress",
        "In Review": "review",
        Done: "done",
      },
    });
    expect(linked?.ok && (linked.data as { statusOptions: string[] }).statusOptions).toEqual([
      "Todo",
      "In Progress",
      "In Review",
      "Done",
    ]);
    const cards = h.store.linkedCards(h.project.id);
    expect(cards).toHaveLength(1);
    const status = await ask(h.server, "boardsync.status", { projectId: h.project.id });
    expect(
      status?.ok && (status.data as { lastSyncedAt: string | null }).lastSyncedAt,
    ).not.toBeNull();
    h.provider.items = [item(1, { status: "Done", updatedAt: "2026-10-02T10:00:00Z" })];
    const now = await ask(h.server, "boardsync.syncNow", { projectId: h.project.id });
    expect(now?.ok && (now.data as { report: { moved: number } }).report.moved).toBe(1);
    const log = await ask(h.server, "boardsync.log", { cardId: cards[0] ?? "" });
    expect(log?.ok && (log.data as { entries: unknown[] }).entries).toEqual([]);
  });

  test("the map, the push switch and unlink", async () => {
    const h = await host(true);
    await ask(h.server, "boardsync.link", { projectId: h.project.id, boardId: "PVT_board1" });
    const map = await ask(h.server, "boardsync.setMap", {
      projectId: h.project.id,
      columnMap: { Todo: "backlog", Done: "done" },
    });
    expect(map?.ok && (map.data as { columnMap: object }).columnMap).toEqual({
      Todo: "backlog",
      Done: "done",
    });
    const bad = await ask(h.server, "boardsync.setMap", {
      projectId: h.project.id,
      columnMap: { Gone: "done" },
    });
    expect(bad && !bad.ok && bad.error.reason).toBe("board_sync_map_invalid");
    const noConfirm = await ask(h.server, "boardsync.setPush", {
      projectId: h.project.id,
      push: true,
      confirm: false,
    });
    expect(noConfirm && !noConfirm.ok && noConfirm.error.reason).toBe("board_sync_confirm");
    const on = await ask(h.server, "boardsync.setPush", {
      projectId: h.project.id,
      push: true,
      confirm: true,
    });
    expect(on?.ok && (on.data as { push: boolean }).push).toBe(true);
    const off = await ask(h.server, "boardsync.unlink", { projectId: h.project.id });
    expect(off?.ok).toBe(true);
    const after = await ask(h.server, "boardsync.status", { projectId: h.project.id });
    expect(after?.ok && after.data).toEqual({ linked: false });
  });

  test("refusals carry their reason: unknown board, no Status field, already linked, not linked", async () => {
    const h = await host(true);
    const unknown = await ask(h.server, "boardsync.link", {
      projectId: h.project.id,
      boardId: "PVT_nope",
    });
    expect(unknown && !unknown.ok && unknown.error.reason).toBe("board_not_found");
    h.provider.hasStatus = false;
    const none = await ask(h.server, "boardsync.link", {
      projectId: h.project.id,
      boardId: "PVT_board1",
    });
    expect(none && !none.ok && none.error.reason).toBe("board_sync_field_not_found");
    h.provider.hasStatus = true;
    await ask(h.server, "boardsync.link", { projectId: h.project.id, boardId: "PVT_board1" });
    const twice = await ask(h.server, "boardsync.link", {
      projectId: h.project.id,
      boardId: "PVT_board1",
    });
    expect(twice && !twice.ok && twice.error.reason).toBe("board_sync_already_linked");
    const notLinked = await ask(h.server, "boardsync.syncNow", { projectId: "nope" });
    expect(notLinked && !notLinked.ok && notLinked.error.reason).toBe("board_sync_not_linked");
  });

  test("host.info announces boardsync, and a host without it refuses with feature_off", async () => {
    const on = await host(true);
    const info = await ask(on.server, "host.info", {});
    expect(info?.ok && (info.data as { features: string[] }).features).toContain("boardsync");
    const off = await host(false);
    const refused = await ask(off.server, "boardsync.boards", {});
    expect(refused && !refused.ok && refused.error.reason).toBe("feature_off");
    const noInfo = await ask(off.server, "host.info", {});
    expect(noInfo?.ok && (noInfo.data as { features: string[] }).features).not.toContain(
      "boardsync",
    );
  });
});
