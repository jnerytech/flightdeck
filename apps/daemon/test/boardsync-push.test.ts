import { describe, expect, test } from "bun:test";
import { setPush } from "../src/boardsync/push.ts";
import { item } from "./boardsync-contract.ts";
import { syncSetup } from "./boardsync-setup.ts";

const T = (hms: string) => `2026-10-01T${hms}Z`;

/** A synced card (Todo at 10:00), moved here to `column`. */
async function moved(push: boolean, column: "review" | "waiting" | "done" | "in_progress") {
  const s = await syncSetup(push);
  s.provider.items = [item(1, { status: "Todo", updatedAt: T("10:00:00") })];
  await s.sync.syncProject(s.project.id);
  const card = s.cards()[0]?.id ?? "";
  s.board.moveCard(card, column);
  return { ...s, card };
}

const reasonOf = (run: Promise<unknown>) =>
  run.then(
    () => undefined,
    (error: { reason?: string; params?: Record<string, unknown> }) => ({
      reason: error.reason,
      params: error.params,
    }),
  );

describe("board-push: local moves go to the provider only when the board allows it", () => {
  test("off by default: a local move is never sent, however often it syncs", async () => {
    const s = await moved(false, "review");
    for (let i = 0; i < 3; i += 1) {
      s.provider.items = [item(1, { status: "Todo", updatedAt: T(`10:0${i}:00`) })];
      await s.sync.syncProject(s.project.id);
    }
    expect(s.provider.setStatusCalls).toEqual([]);
  });

  test("on: a local move calls setStatus once with the option of the column, and the mark clears", async () => {
    const s = await moved(true, "review");
    const report = await s.sync.syncProject(s.project.id);
    expect(report.pushed).toBe(1);
    expect(s.provider.setStatusCalls).toEqual([{ itemId: "PVTI_1", optionId: "o3" }]);
    expect(s.provider.items[0]?.status).toBe("In Review");
    expect(s.store.externalOf(s.card)).toMatchObject({
      externalStatus: "In Review",
      localMovedAt: null,
    });
    expect((await s.sync.syncProject(s.project.id)).pushed).toBe(0);
    expect(s.provider.setStatusCalls).toHaveLength(1);
  });

  test("a column no option is mapped to sends nothing, and the mark clears", async () => {
    const s = await moved(true, "waiting");
    const report = await s.sync.syncProject(s.project.id);
    expect(report.pushed).toBe(0);
    expect(s.provider.setStatusCalls).toEqual([]);
    expect(s.store.externalOf(s.card).localMovedAt).toBeNull();
  });

  test("a failure keeps the local move, logs it, and is tried again at the next sync", async () => {
    const s = await moved(true, "done");
    let fail = true;
    const set = s.provider.setStatus.bind(s.provider);
    s.provider.setStatus = async (...args) => {
      if (fail) {
        throw Object.assign(new Error("down"), { reason: "board_sync_failed" });
      }
      return set(...args);
    };
    expect((await s.sync.syncProject(s.project.id)).pushed).toBe(0);
    expect(s.cards()[0]?.column).toBe("done");
    expect(s.store.logOf(s.card)[0]).toMatchObject({
      kind: "push_failed",
      detail: "board_sync_failed",
    });
    expect(s.store.externalOf(s.card).localMovedAt).not.toBeNull();
    fail = false;
    expect((await s.sync.syncProject(s.project.id)).pushed).toBe(1);
  });

  test("after five failures in a row it stops trying and says so once", async () => {
    const s = await moved(true, "done");
    s.provider.setStatus = async () => {
      throw Object.assign(new Error("down"), { reason: "board_sync_failed" });
    };
    for (let i = 0; i < 8; i += 1) await s.sync.syncProject(s.project.id);
    const kinds = s.store.logOf(s.card).map((entry) => entry.kind);
    expect(kinds.filter((kind) => kind === "push_failed")).toHaveLength(5);
    expect(kinds.filter((kind) => kind === "push_gave_up")).toHaveLength(1);
  });

  test("push never touches a card that has no external item, or one that is gone", async () => {
    const s = await moved(true, "review");
    const local = s.board.createCard(s.project.id, { title: "Only here", description: "" });
    s.board.moveCard(local.id, "done");
    s.store.setExternal(s.card, { externalGone: true });
    const report = await s.sync.syncProject(s.project.id);
    expect(report.pushed).toBe(0);
    expect(s.provider.setStatusCalls).toEqual([]);
    expect(s.provider.items).toHaveLength(1);
  });
});

describe("board-push: switching it on", () => {
  test("needs the confirm, and the write scope, refused with the scope's name", async () => {
    const s = await syncSetup(false);
    const deps = { store: s.store, provider: s.provider };
    expect((await reasonOf(setPush(deps, s.project.id, true, false)))?.reason).toBe(
      "board_sync_confirm",
    );
    s.provider.scope = { read: true, write: false };
    expect(await reasonOf(setPush(deps, s.project.id, true, true))).toEqual({
      reason: "board_sync_scope_missing",
      params: { scope: "project" },
    });
    expect(s.store.get(s.project.id)?.push).toBe(false);
    s.provider.scope = { read: true, write: true };
    expect((await setPush(deps, s.project.id, true, true)).push).toBe(true);
    expect(s.store.get(s.project.id)?.push).toBe(true);
  });

  test("turning it off needs neither, and an unlinked project is refused", async () => {
    const s = await syncSetup(true);
    const deps = { store: s.store, provider: s.provider };
    s.provider.scope = { read: true, write: false };
    expect((await setPush(deps, s.project.id, false, false)).push).toBe(false);
    expect((await reasonOf(setPush(deps, "nope", false, false)))?.reason).toBe(
      "board_sync_not_linked",
    );
  });
});
