import { describe, expect, test } from "bun:test";
import type { SyncReport } from "../src/boardsync/engine.ts";
import { UNTRUSTED_MARK } from "../src/issues/issues.ts";
import { item } from "./boardsync-contract.ts";
import { syncSetup } from "./boardsync-setup.ts";

const ZERO: SyncReport = {
  created: 0,
  moved: 0,
  updated: 0,
  conflicts: 0,
  unmapped: 0,
  gone: 0,
  skipped: 0,
  pushed: 0,
  redacted: 0,
  truncated: false,
  notModified: false,
};

describe("board-pull: items become cards, statuses move them", () => {
  test("a new issue item becomes a card in its mapped column with title, body, link and external id", async () => {
    const s = await syncSetup();
    s.provider.items = [item(1, { status: "In Progress" })];
    const report = await s.sync.syncProject(s.project.id);
    expect(report).toEqual({ ...ZERO, created: 1 });
    const [card] = s.cards();
    expect(card).toMatchObject({
      title: "Item 1",
      column: "in_progress",
      issueRef: "github:acme/app#1",
      issueExternal: 0,
    });
    expect(card?.description).toContain("Body 1");
    expect(card?.description).toContain("https://github.com/acme/app/issues/1");
    expect(s.store.externalOf(card?.id ?? "")).toMatchObject({
      externalId: "PVTI_1",
      externalUrl: "https://github.com/acme/app/issues/1",
      externalStatus: "In Progress",
      localMovedAt: null,
      externalGone: false,
    });
  });

  test("the card shows the item it follows and whether it left the board", async () => {
    const s = await syncSetup();
    s.provider.items = [item(1)];
    await s.sync.syncProject(s.project.id);
    const id = s.cards()[0]?.id ?? "";
    expect(s.board.getCard(id)).toMatchObject({
      externalUrl: "https://github.com/acme/app/issues/1",
      externalGone: false,
    });
    s.provider.items = [item(1, { archived: true, updatedAt: "2026-10-02T10:00:00Z" })];
    await s.sync.syncProject(s.project.id);
    expect(s.board.getCard(id).externalGone).toBe(true);
  });

  test("a third party's issue carries the mark and gets no automatic approval", async () => {
    const s = await syncSetup();
    s.provider.items = [
      item(2, { content: { kind: "issue", ref: "github:acme/app#2", external: true } }),
    ];
    await s.sync.syncProject(s.project.id);
    const [card] = s.cards();
    expect(card?.description.startsWith(UNTRUSTED_MARK)).toBe(true);
    expect(card?.issueExternal).toBe(1);
    expect(s.suspended).toEqual([`card:${card?.id}`]);
  });

  test("an issue that already has a card on the project is linked, not duplicated", async () => {
    const s = await syncSetup();
    const existing = s.board.createCard(s.project.id, {
      title: "Made from the issue before",
      description: "",
      issueRef: "github:acme/app#3",
    });
    s.provider.items = [item(3)];
    const report = await s.sync.syncProject(s.project.id);
    expect(report.created).toBe(0);
    expect(s.cards()).toHaveLength(1);
    expect(s.store.externalOf(existing.id).externalId).toBe("PVTI_3");
  });

  test("a draft item and a pull request item become cards without an issue ref", async () => {
    const s = await syncSetup();
    s.provider.items = [
      item(4, { content: { kind: "draft" }, url: "" }),
      item(5, { content: { kind: "pull_request", ref: "github:acme/app#5" } }),
    ];
    await s.sync.syncProject(s.project.id);
    const cards = s.cards();
    expect(cards.map((c) => [c.title, c.issueRef])).toEqual([
      ["Item 4", null],
      ["Item 5", null],
    ]);
    expect(cards[1]?.description).toContain("https://github.com/acme/app/issues/5");
  });

  test("a status the map does not know leaves a new card in the backlog and is counted", async () => {
    const s = await syncSetup();
    s.provider.items = [item(6, { status: "Blocked" })];
    const report = await s.sync.syncProject(s.project.id);
    expect(report).toEqual({ ...ZERO, created: 1, unmapped: 1 });
    expect(s.cards()[0]?.column).toBe("backlog");
  });

  test("a redacted item is a link-only card, counted", async () => {
    const s = await syncSetup();
    s.provider.items = [item(7, { content: null, title: "", body: "", url: "" })];
    const report = await s.sync.syncProject(s.project.id);
    expect(report).toEqual({ ...ZERO, created: 1, redacted: 1 });
    expect(s.cards()[0]?.title.length).toBeGreaterThan(0);
  });

  test("a status change at the provider moves the card, once", async () => {
    const s = await syncSetup();
    s.provider.items = [item(1, { status: "Todo" })];
    await s.sync.syncProject(s.project.id);
    s.provider.items = [item(1, { status: "In Review", updatedAt: "2026-10-02T10:00:00Z" })];
    expect(await s.sync.syncProject(s.project.id)).toEqual({ ...ZERO, moved: 1 });
    expect(s.cards()[0]?.column).toBe("review");
    expect(await s.sync.syncProject(s.project.id)).toEqual({ ...ZERO, notModified: true });
    const card = s.cards()[0];
    expect(s.store.externalOf(card?.id ?? "")).toMatchObject({
      externalStatus: "In Review",
      localMovedAt: null,
    });
  });

  test("a card that is queued or running is not moved by the provider, and the log says why", async () => {
    const s = await syncSetup();
    s.provider.items = [item(1, { status: "In Progress" })];
    await s.sync.syncProject(s.project.id);
    const card = s.cards()[0];
    // It waits in the start queue: the card is made busy directly.
    s.db
      .query("INSERT INTO card_runs (id, card_id, queued_at) VALUES (?, ?, ?)")
      .run("run-1", card?.id ?? "", "2026-10-02T09:00:00Z");
    s.provider.items = [item(1, { status: "Done", updatedAt: "2026-10-02T10:00:00Z" })];
    const report = await s.sync.syncProject(s.project.id);
    expect(report).toEqual({ ...ZERO, skipped: 1 });
    expect(s.cards()[0]?.column).toBe("in_progress");
    expect(s.store.logOf(card?.id ?? "")[0]).toMatchObject({ kind: "move_skipped" });
  });

  test("a changed title at the provider is pulled, and the old title goes to the log", async () => {
    const s = await syncSetup();
    s.provider.items = [item(1)];
    await s.sync.syncProject(s.project.id);
    s.provider.items = [item(1, { title: "Renamed", updatedAt: "2026-10-02T10:00:00Z" })];
    expect(await s.sync.syncProject(s.project.id)).toEqual({ ...ZERO, updated: 1 });
    const card = s.cards()[0];
    expect(card?.title).toBe("Renamed");
    expect(s.store.logOf(card?.id ?? "")[0]).toMatchObject({
      kind: "title_changed",
      lostValue: "Item 1",
      keptValue: "Renamed",
    });
  });

  test("an archived item, or one that left a full pull, flags its card gone and the card stays", async () => {
    const s = await syncSetup();
    s.provider.items = [item(1), item(2)];
    await s.sync.syncProject(s.project.id);
    s.provider.items = [item(1, { archived: true, updatedAt: "2026-10-02T10:00:00Z" })];
    const report = await s.sync.syncProject(s.project.id);
    expect(report.gone).toBe(2);
    expect(s.cards()).toHaveLength(2);
    for (const card of s.cards()) expect(s.store.externalOf(card.id).externalGone).toBe(true);
  });

  test("a truncated pull flags nobody gone", async () => {
    const s = await syncSetup();
    s.provider.items = [item(1), item(2)];
    await s.sync.syncProject(s.project.id);
    const pull = s.provider.pull.bind(s.provider);
    s.provider.pull = async (id, since) => ({
      ...(await pull(id, since)),
      items: [item(1)],
      truncated: true,
      notModified: false,
    });
    const report = await s.sync.syncProject(s.project.id);
    expect(report).toEqual({ ...ZERO, truncated: true });
  });

  test("a pull that says notModified changes nothing, and the sync status is saved", async () => {
    const s = await syncSetup();
    s.provider.items = [item(1)];
    await s.sync.syncProject(s.project.id);
    const report = await s.sync.syncProject(s.project.id);
    expect(report).toEqual({ ...ZERO, notModified: true });
    expect(s.store.get(s.project.id)).toMatchObject({
      lastSyncedAt: "2026-10-02T12:00:00.000Z",
      lastError: null,
      truncated: false,
    });
    expect(s.store.get(s.project.id)?.cursor).toBeTruthy();
  });

  test("a provider failure is saved on the link with its reason and thrown", async () => {
    const s = await syncSetup();
    s.provider.beforeCall = (method) => {
      if (method === "pull") {
        throw Object.assign(new Error("slow down"), { reason: "board_sync_rate_limited" });
      }
    };
    await expect(s.sync.syncProject(s.project.id)).rejects.toThrow("slow down");
    expect(s.store.get(s.project.id)?.lastError).toBe("board_sync_rate_limited");
  });
});
