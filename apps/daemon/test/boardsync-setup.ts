import { afterEach } from "bun:test";
import { BoardSync } from "../src/boardsync/engine.ts";
import { DEFAULT_COLUMN_MAP } from "../src/boardsync/map.ts";
import { BoardSyncStore } from "../src/boardsync/store.ts";
import { newBoard } from "./board-helpers.ts";
import { BOARD, FakeProvider } from "./boardsync-fake.ts";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

export async function syncSetup(push = false) {
  const ctx = newBoard();
  cleanups.push(() => ctx.board.stop());
  const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
  const store = new BoardSyncStore(ctx.store.db);
  store.link({
    projectId: project.id,
    provider: "fake",
    boardId: BOARD.id,
    boardTitle: BOARD.title,
    statusFieldId: "PVTSSF_status",
    columnMap: { ...DEFAULT_COLUMN_MAP },
  });
  if (push) store.update(project.id, { push: true });
  const provider = new FakeProvider();
  const suspended: string[] = [];
  const clock = { now: Date.parse("2026-10-02T12:00:00Z") };
  const sync = new BoardSync({
    board: ctx.board,
    store,
    provider,
    autoApprove: { suspend: (key) => suspended.push(key) },
    clock: () => clock.now,
  });
  const cards = () =>
    ctx.store.db
      .query(
        "SELECT id, title, description, board_column AS column, issue_ref AS issueRef, issue_external AS issueExternal FROM cards ORDER BY created_at, id",
      )
      .all() as Array<{
      id: string;
      title: string;
      description: string;
      column: string;
      issueRef: string | null;
      issueExternal: number;
    }>;
  return { ...ctx, db: ctx.store.db, project, store, provider, sync, suspended, clock, cards };
}
