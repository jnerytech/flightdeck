import { afterEach, describe, expect, test } from "bun:test";
import { BoardSyncStore, LOG_LIMIT, type SyncLogEntry } from "../src/boardsync/store.ts";
import { newBoard } from "./board-helpers.ts";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function setup() {
  const ctx = newBoard();
  cleanups.push(() => ctx.board.stop());
  const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
  const card = ctx.board.createCard(project.id, { title: "A card", description: "" });
  return { ...ctx, project, card, store: new BoardSyncStore(ctx.store.db) };
}

const LINK = {
  provider: "github-projects",
  boardId: "PVT_board1",
  boardTitle: "Roadmap",
  statusFieldId: "PVTSSF_status",
  columnMap: { Todo: "backlog", Done: "done" } as const,
};

const entry = (n: number): SyncLogEntry => ({
  at: `2026-10-01T10:${String(n % 60).padStart(2, "0")}:00Z`,
  kind: "conflict",
  winner: "external",
  lostValue: "review",
  lostAt: "2026-10-01T09:00:00Z",
  keptValue: "Done",
  keptAt: "2026-10-01T09:30:00Z",
  detail: `entry ${n}`,
});

const reasonOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return (error as { reason?: string }).reason;
  }
  return undefined;
};

describe("board-sync-store: links, the cards' external fields and the log", () => {
  test("a project links one board, with push off and the map as given", async () => {
    const s = await setup();
    const link = s.store.link({ projectId: s.project.id, ...LINK });
    expect(link).toMatchObject({
      projectId: s.project.id,
      boardId: "PVT_board1",
      push: false,
      columnMap: { Todo: "backlog", Done: "done" },
      lastSyncedAt: null,
      truncated: false,
    });
    expect(s.store.get(s.project.id)).toEqual(link);
    expect(s.store.list()).toEqual([link]);
    expect(reasonOf(() => s.store.link({ projectId: s.project.id, ...LINK }))).toBe(
      "board_sync_already_linked",
    );
  });

  test("update changes push, the map and the sync status", async () => {
    const s = await setup();
    s.store.link({ projectId: s.project.id, ...LINK });
    const updated = s.store.update(s.project.id, {
      push: true,
      columnMap: { Todo: "backlog" },
      cursor: "c1",
      lastSyncedAt: "2026-10-01T10:00:00Z",
      lastError: "boom",
      truncated: true,
      pausedUntil: "2026-10-01T11:00:00Z",
    });
    expect(updated).toMatchObject({
      push: true,
      columnMap: { Todo: "backlog" },
      cursor: "c1",
      lastError: "boom",
      truncated: true,
      pausedUntil: "2026-10-01T11:00:00Z",
    });
    expect(reasonOf(() => s.store.update("nope", { push: true }))).toBe("board_sync_not_linked");
  });

  test("unlinking removes the link and keeps the cards' external fields", async () => {
    const s = await setup();
    s.store.link({ projectId: s.project.id, ...LINK });
    s.store.setExternal(s.card.id, { externalId: "PVTI_1", externalUrl: "https://x/1" });
    s.store.unlink(s.project.id);
    expect(s.store.get(s.project.id)).toBeNull();
    expect(s.store.externalOf(s.card.id)).toMatchObject({ externalId: "PVTI_1" });
    expect(reasonOf(() => s.store.unlink(s.project.id))).toBe("board_sync_not_linked");
  });

  test("a card's external fields are stored and the card is found by its external id", async () => {
    const s = await setup();
    expect(s.store.externalOf(s.card.id)).toEqual({
      externalId: null,
      externalUrl: null,
      externalStatus: null,
      externalUpdatedAt: null,
      localMovedAt: null,
      externalGone: false,
    });
    s.store.setExternal(s.card.id, {
      externalId: "PVTI_9",
      externalUrl: "https://github.com/orgs/acme/projects/3/views/1?pane=issue&itemId=9",
      externalStatus: "Todo",
      externalUpdatedAt: "2026-10-01T10:00:00Z",
      externalGone: true,
    });
    expect(s.store.externalOf(s.card.id)).toMatchObject({
      externalId: "PVTI_9",
      externalStatus: "Todo",
      externalGone: true,
    });
    expect(s.store.cardByExternal(s.project.id, "PVTI_9")).toBe(s.card.id);
    expect(s.store.cardByExternal(s.project.id, "PVTI_none")).toBeNull();
  });

  test("moving a card to another column marks when it moved, and setExternal can clear it", async () => {
    const s = await setup();
    expect(s.store.externalOf(s.card.id).localMovedAt).toBeNull();
    s.board.moveCard(s.card.id, "review");
    const moved = s.store.externalOf(s.card.id).localMovedAt;
    expect(Number.isNaN(Date.parse(moved ?? ""))).toBe(false);
    s.store.setExternal(s.card.id, { localMovedAt: null });
    expect(s.store.externalOf(s.card.id).localMovedAt).toBeNull();
  });

  test("the log is per card, newest first, and keeps the last 50", async () => {
    const s = await setup();
    const other = s.board.createCard(s.project.id, { title: "Other", description: "" });
    for (let n = 1; n <= LOG_LIMIT + 5; n += 1) s.store.addLog(s.card.id, entry(n));
    s.store.addLog(other.id, entry(900));
    const log = s.store.logOf(s.card.id);
    expect(log).toHaveLength(LOG_LIMIT);
    expect(log[0]?.detail).toBe(`entry ${LOG_LIMIT + 5}`);
    expect(log.at(-1)?.detail).toBe("entry 6");
    expect(s.store.logOf(other.id)).toHaveLength(1);
    expect(log[0]).toMatchObject({ winner: "external", lostValue: "review", keptValue: "Done" });
  });
});
