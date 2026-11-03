import { describe, expect, test } from "bun:test";
import { item } from "./boardsync-contract.ts";
import { syncSetup } from "./boardsync-setup.ts";

const T = (hms: string) => `2026-10-01T${hms}Z`;

/** A synced card in the backlog (the item was Todo at 10:00), then moved here at `movedAt`. */
async function moved(push: boolean, movedAt: string) {
  const s = await syncSetup(push);
  s.provider.items = [item(1, { status: "Todo", updatedAt: T("10:00:00") })];
  await s.sync.syncProject(s.project.id);
  const card = s.cards()[0]?.id ?? "";
  s.board.moveCard(card, "review");
  s.store.setExternal(card, { localMovedAt: movedAt });
  return { ...s, card };
}

describe("board-conflict: the newest change wins, the loser is logged", () => {
  test("a change on this side only is not a conflict: the card stays and keeps its mark", async () => {
    const s = await moved(false, T("11:00:00"));
    const report = await s.sync.syncProject(s.project.id);
    expect(report.conflicts).toBe(0);
    expect(s.cards()[0]?.column).toBe("review");
    expect(s.store.externalOf(s.card).localMovedAt).toBe(T("11:00:00"));
    expect(s.store.logOf(s.card)).toEqual([]);
  });

  test("both changed and the provider's change is later: it wins, and the local value is logged", async () => {
    const s = await moved(false, T("11:00:00"));
    s.provider.items = [item(1, { status: "Done", updatedAt: T("12:00:00") })];
    const report = await s.sync.syncProject(s.project.id);
    expect(report.conflicts).toBe(1);
    expect(s.cards()[0]?.column).toBe("done");
    expect(s.store.logOf(s.card)).toEqual([
      {
        at: "2026-10-02T12:00:00.000Z",
        kind: "conflict",
        winner: "external",
        lostValue: "review",
        lostAt: T("11:00:00"),
        keptValue: "Done",
        keptAt: T("12:00:00"),
        detail: null,
      },
    ]);
    expect(s.store.externalOf(s.card)).toMatchObject({
      externalStatus: "Done",
      localMovedAt: null,
    });
  });

  test("both changed and this side's move is later: it wins, the provider's value is logged, and it is not a conflict again", async () => {
    const s = await moved(false, T("13:00:00"));
    s.provider.items = [item(1, { status: "Done", updatedAt: T("12:00:00") })];
    const report = await s.sync.syncProject(s.project.id);
    expect(report.conflicts).toBe(1);
    expect(s.cards()[0]?.column).toBe("review");
    expect(s.store.logOf(s.card)[0]).toMatchObject({
      kind: "conflict",
      winner: "local",
      lostValue: "Done",
      lostAt: T("12:00:00"),
      keptValue: "review",
      keptAt: T("13:00:00"),
    });
    // What the provider said is now known, so the same state is not argued over again.
    s.provider.items = [item(1, { status: "Done", updatedAt: T("12:00:00"), title: "Item 1" })];
    const again = await s.sync.syncProject(s.project.id);
    expect(again.conflicts).toBe(0);
    expect(s.store.logOf(s.card)).toHaveLength(1);
    expect(s.store.externalOf(s.card).localMovedAt).toBe(T("13:00:00"));
  });

  test("both ended in the same place: no conflict and no log, and the mark clears", async () => {
    const s = await moved(false, T("11:00:00"));
    s.board.moveCard(s.card, "done");
    s.store.setExternal(s.card, { localMovedAt: T("11:00:00") });
    s.provider.items = [item(1, { status: "Done", updatedAt: T("12:00:00") })];
    const report = await s.sync.syncProject(s.project.id);
    expect(report.conflicts).toBe(0);
    expect(s.store.logOf(s.card)).toEqual([]);
    expect(s.store.externalOf(s.card).localMovedAt).toBeNull();
  });

  test("a tie within two seconds goes to the provider when push is off", async () => {
    const s = await moved(false, T("11:00:00"));
    s.provider.items = [item(1, { status: "Done", updatedAt: T("11:00:01") })];
    await s.sync.syncProject(s.project.id);
    expect(s.cards()[0]?.column).toBe("done");
    expect(s.store.logOf(s.card)[0]?.winner).toBe("external");
  });

  test("a tie within two seconds goes to this side when push is on", async () => {
    const s = await moved(true, T("11:00:00"));
    s.provider.items = [item(1, { status: "Done", updatedAt: T("11:00:01") })];
    await s.sync.syncProject(s.project.id);
    expect(s.cards()[0]?.column).toBe("review");
    expect(s.store.logOf(s.card)[0]?.winner).toBe("local");
  });

  test("the log is never cleared by a later sync", async () => {
    const s = await moved(false, T("11:00:00"));
    s.provider.items = [item(1, { status: "Done", updatedAt: T("12:00:00") })];
    await s.sync.syncProject(s.project.id);
    s.provider.items = [item(1, { status: "In Review", updatedAt: T("14:00:00") })];
    await s.sync.syncProject(s.project.id);
    s.provider.items = [item(1, { status: "In Review", updatedAt: T("15:00:00"), title: "New" })];
    await s.sync.syncProject(s.project.id);
    const kinds = s.store.logOf(s.card).map((entry) => entry.kind);
    expect(kinds).toContain("conflict");
    expect(kinds.length).toBeGreaterThanOrEqual(2);
  });
});
