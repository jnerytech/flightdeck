import { afterEach, describe, expect, test } from "bun:test";
import type { BoardSyncLogEntry, BoardSyncStatus } from "@flightdeck/protocol";
import { ptBR } from "../../src/i18n/pt-BR.ts";
import { liveScreen, registerDom } from "../dom.ts";

registerDom();
const { act, cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { BoardSyncControl, CardSyncLog } = await import("../../src/features/board/board-sync.tsx");

afterEach(cleanup);

const t = ptBR.boardSyncUi;
const REFUSED = "o host recusou desligar o quadro";

/** A store that answers the sync commands from a script; nothing leaves the test. */
function stubStore(
  status: BoardSyncStatus,
  entries: BoardSyncLogEntry[] = [],
  unlink: "accepted" | "refused" = "accepted",
) {
  const asked: string[] = [];
  const store = {
    hostRequest: async (_host: string, type: string) => {
      asked.push(type);
      if (type === "boardsync.status") return { ok: true, data: status };
      if (type === "boardsync.log") return { ok: true, data: { entries } };
      if (type === "boardsync.setPush") return { ok: true, data: { ...status, push: true } };
      if (type === "boardsync.unlink") {
        return unlink === "refused"
          ? { ok: false, code: "invalid", message: REFUSED }
          : { ok: true, data: undefined };
      }
      return { ok: true, data: { boards: [] } };
    },
  };
  return { store: store as never, asked };
}

const linked: BoardSyncStatus = {
  linked: true,
  boardId: "PVT_1",
  boardTitle: "Roadmap",
  columnMap: { Todo: "backlog" },
  statusOptions: ["Todo"],
  push: false,
  lastSyncedAt: "2026-10-02T10:00:00Z",
  pausedUntil: "2026-10-02T11:00:00Z",
  lastError: "board_sync_failed",
  truncated: false,
};

async function open(status: BoardSyncStatus, unlink: "accepted" | "refused" = "accepted") {
  const { store } = stubStore(status, [], unlink);
  render(<BoardSyncControl store={store} hostId="h" projectId="p" />);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: t.button }));
  });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeNull());
}

describe("board-sync-gaps: the Sync dialog", () => {
  test("a paused board and its last error are said in the dialog", async () => {
    await open(linked);
    const dialog = within(screen.getByRole("dialog"));
    await waitFor(() => expect(dialog.queryByText(/Em pausa até/)).not.toBeNull());
    expect(dialog.queryByText(new RegExp(linked.lastError as string))).not.toBeNull();
  });

  test("a board never synced says so", async () => {
    await open({ ...linked, lastSyncedAt: null, pausedUntil: null, lastError: null });
    await waitFor(() => expect(screen.queryByText(t.never)).not.toBeNull());
  });

  // The "no boards" line also shows for a frame while the list loads, so the tests that list
  // boards reach it only by timing (the release gate saw line 164 uncovered once, #747): this
  // one waits for the host's answer and asserts the line on purpose.
  test("not linked and the host has no board to offer: the dialog says so, with nothing to pick", async () => {
    const { store, asked } = stubStore({ linked: false });
    render(<BoardSyncControl store={store} hostId="h" projectId="p" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t.button }));
    });
    await waitFor(() => expect(asked).toContain("boardsync.boards"));
    const dialog = within(screen.getByRole("dialog"));
    await waitFor(() => expect(dialog.queryByText(t.noBoards)).not.toBeNull());
    expect(dialog.queryAllByRole("radio")).toHaveLength(0);
    expect(dialog.getByRole("button", { name: t.link }).hasAttribute("disabled")).toBe(true);
  });

  test("turning push on asks first, and Cancel takes the question back", async () => {
    await open(linked);
    const dialog = within(screen.getByRole("dialog"));
    await waitFor(() => expect(dialog.queryByRole("checkbox")).not.toBeNull());
    await act(async () => {
      fireEvent.click(dialog.getByRole("checkbox"));
    });
    expect(dialog.queryByText(t.pushConfirm)).not.toBeNull();
    const cancels = dialog.getAllByRole("button", { name: ptBR.common.cancel });
    await act(async () => {
      fireEvent.click(cancels[0] as HTMLElement);
    });
    expect(dialog.queryByText(t.pushConfirm)).toBeNull();
  });

  test("the footer's Cancel and Escape both close the dialog", async () => {
    await open(linked);
    const dialog = within(screen.getByRole("dialog"));
    await act(async () => {
      fireEvent.click(
        dialog.getAllByRole("button", { name: ptBR.common.cancel }).pop() as HTMLElement,
      );
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t.button }));
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeNull());
    await act(async () => {
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("board-sync-gaps: a card's sync log", () => {
  const entry = (kind: string, over: Partial<BoardSyncLogEntry> = {}): BoardSyncLogEntry => ({
    at: `2026-10-02T10:00:0${kind.length % 10}Z`,
    kind,
    winner: null,
    lostValue: "Done",
    lostAt: "2026-10-02T09:00:00Z",
    keptValue: `kept-${kind}`,
    keptAt: "2026-10-02T09:30:00Z",
    detail: kind,
    ...over,
  });

  test("a card with nothing in its log says that", async () => {
    const { store } = stubStore(linked, []);
    render(<CardSyncLog store={store} hostId="h" cardId="c" />);
    await waitFor(() => expect(screen.queryByText(t.logEmpty)).not.toBeNull());
  });

  test("every kind of entry reads as a line, and a kind nobody knows shows as it is", async () => {
    const { store } = stubStore(linked, [
      entry("conflict", { winner: "local" }),
      entry("conflict", { winner: "external" }),
      entry("move_skipped"),
      entry("push_failed"),
      entry("push_gave_up"),
      entry("title_changed"),
      entry("something_new"),
    ]);
    render(<CardSyncLog store={store} hostId="h" cardId="c" />);
    await waitFor(() => expect(screen.queryAllByRole("listitem")).toHaveLength(7));
    const lines = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(lines).toContain("something_new");
    expect(new Set(lines).size).toBe(7);
  });
});

// #4467: the reload after a refused unlink erased the refusal and the dialog said nothing.
describe("board-sync-gaps: Unlink (#4467)", () => {
  const unlinkAndConfirm = async (dialog: ReturnType<typeof within>) => {
    await waitFor(() => expect(dialog.queryByRole("button", { name: t.unlink })).not.toBeNull());
    await act(async () => {
      fireEvent.click(dialog.getByRole("button", { name: t.unlink }));
    });
    const confirm = within(screen.getByRole("alertdialog"));
    await act(async () => {
      fireEvent.click(confirm.getByRole("button", { name: t.unlink }));
    });
  };

  test("a refused Unlink keeps the refusal in the dialog and the link on screen", async () => {
    await open(linked, "refused");
    const dialog = within(screen.getByRole("dialog"));
    await unlinkAndConfirm(dialog);
    await waitFor(() => expect(dialog.queryByText(new RegExp(REFUSED)) !== null).toBe(true));
    expect(dialog.queryByText(/Roadmap/) !== null).toBe(true);
  });

  test("an accepted Unlink shows no error", async () => {
    await open(linked, "accepted");
    const dialog = within(screen.getByRole("dialog"));
    await unlinkAndConfirm(dialog);
    expect(dialog.queryByRole("alert")).toBeNull();
  });
});
