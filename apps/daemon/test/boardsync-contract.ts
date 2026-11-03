/** Phase 38: the one suite every `BoardProvider` has to pass (the fake here, GitHub's in board-graphql). */
import { describe, expect, test } from "bun:test";
import type { BoardProvider, ExternalItem } from "../src/boardsync/provider.ts";

export interface ContractHarness {
  provider: BoardProvider;
  boardId: string;
  /** Whether `pull(since)` answers `notModified` when nothing changed. */
  conditional: boolean;
  /** Replaces the board's items. */
  seed(items: ExternalItem[]): void;
  setScopes(scopes: { read: boolean; write: boolean }): void;
  setHasStatus(has: boolean): void;
  setPageSize(size: number): void;
  /** How many status changes reached the provider. */
  mutations(): number;
}

export const item = (n: number, over: Partial<ExternalItem> = {}): ExternalItem => ({
  id: `PVTI_${n}`,
  url: `https://github.com/acme/app/issues/${n}`,
  title: `Item ${n}`,
  body: `Body ${n}`,
  status: "Todo",
  updatedAt: "2026-10-01T10:00:00Z",
  archived: false,
  content: { kind: "issue", ref: `github:acme/app#${n}`, external: false },
  ...over,
});

const reasonOf = async (run: Promise<unknown>) =>
  run.then(
    () => undefined,
    (error: { reason?: string; params?: Record<string, unknown> }) => ({
      reason: error.reason,
      params: error.params,
    }),
  );

export function providerContract(name: string, make: () => ContractHarness) {
  describe(`board-provider-contract: ${name}`, () => {
    test("scopes tell what the login may do", async () => {
      const h = make();
      h.setScopes({ read: true, write: false });
      expect(await h.provider.scopes()).toEqual({ read: true, write: false });
      h.setScopes({ read: true, write: true });
      expect(await h.provider.scopes()).toEqual({ read: true, write: true });
    });

    test("the boards are listed with an id, a title, the owner and a link", async () => {
      const h = make();
      const boards = await h.provider.listBoards();
      expect(boards.find((board) => board.id === h.boardId)).toMatchObject({
        title: "Roadmap",
        owner: "acme",
        number: 3,
      });
    });

    test("the Status field has an id and its options; a board without one answers null", async () => {
      const h = make();
      const field = await h.provider.statusField(h.boardId);
      expect(field?.options.map((option) => option.name)).toEqual([
        "Todo",
        "In Progress",
        "In Review",
        "Done",
      ]);
      expect(field?.fieldId).toBeTruthy();
      h.setHasStatus(false);
      expect(await h.provider.statusField(h.boardId)).toBeNull();
    });

    test("a pull reads every page and gives a cursor", async () => {
      const h = make();
      h.setPageSize(100);
      h.seed(Array.from({ length: 250 }, (_, i) => item(i + 1)));
      const pulled = await h.provider.pull(h.boardId);
      expect(pulled.items).toHaveLength(250);
      expect(pulled.notModified).toBe(false);
      expect(pulled.truncated).toBe(false);
      expect(pulled.cursor).toBeTruthy();
      expect(pulled.items[0]).toMatchObject({ id: "PVTI_1", status: "Todo", title: "Item 1" });
    });

    test("an item's content says what it is, and a redacted one is counted", async () => {
      const h = make();
      h.seed([
        item(1, { content: { kind: "issue", ref: "github:acme/app#1", external: true } }),
        item(2, { content: { kind: "draft" } }),
        item(3, { content: null }),
      ]);
      const pulled = await h.provider.pull(h.boardId);
      expect(pulled.items.map((i) => i.content?.kind ?? null)).toEqual(["issue", "draft", null]);
      expect(pulled.items[0]?.content?.external).toBe(true);
      expect(pulled.redacted).toBe(1);
    });

    test("with the cursor and nothing changed, a conditional provider says notModified", async () => {
      const h = make();
      h.seed([item(1)]);
      const first = await h.provider.pull(h.boardId);
      const again = await h.provider.pull(h.boardId, first.cursor);
      if (h.conditional) {
        expect(again.notModified).toBe(true);
        expect(again.items).toEqual([]);
      } else {
        expect(again.items).toHaveLength(1);
      }
      h.seed([item(1, { status: "Done", updatedAt: "2026-10-02T10:00:00Z" })]);
      const changed = await h.provider.pull(h.boardId, first.cursor);
      expect(changed.notModified).toBe(false);
      expect(changed.items[0]?.status).toBe("Done");
    });

    test("setStatus changes the item and answers the provider's time; the next pull shows it", async () => {
      const h = make();
      h.seed([item(1)]);
      const field = await h.provider.statusField(h.boardId);
      const done = field?.options.find((option) => option.name === "Done");
      const result = await h.provider.setStatus(h.boardId, "PVTI_1", done?.id ?? "");
      expect(Number.isNaN(Date.parse(result.updatedAt))).toBe(false);
      expect((await h.provider.pull(h.boardId)).items[0]?.status).toBe("Done");
      expect(h.mutations()).toBe(1);
    });

    test("setStatus without the write scope is refused with the scope's name, and sends nothing", async () => {
      const h = make();
      h.seed([item(1)]);
      h.setScopes({ read: true, write: false });
      expect(await reasonOf(h.provider.setStatus(h.boardId, "PVTI_1", "o4"))).toEqual({
        reason: "board_sync_scope_missing",
        params: { scope: "project" },
      });
      expect(h.mutations()).toBe(0);
    });

    test("a board that does not exist is board_not_found", async () => {
      const h = make();
      expect((await reasonOf(h.provider.pull("PVT_nope")))?.reason).toBe("board_not_found");
    });
  });
}
