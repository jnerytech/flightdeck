import { afterEach, describe, expect, test } from "bun:test";
import type { BoardSyncLogEntry } from "@flightdeck/protocol";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
const { cleanup, render, waitFor, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { CardSyncLog } = await import("../src/components/board/board-sync.tsx");

afterEach(cleanup);

const same = (winner: "local" | "external"): BoardSyncLogEntry => ({
  at: "2026-10-02T10:00:08Z",
  kind: "conflict",
  winner,
  lostValue: "Done",
  lostAt: "2026-10-02T09:00:00Z",
  keptValue: "Review",
  keptAt: "2026-10-02T09:30:00Z",
  detail: "conflict",
});

describe("board-sync-chaves: the log of a card keeps every entry, even two that read the same", () => {
  test("two conflicts of the same second, kind and values are two lines under two keys", async () => {
    const store = {
      hostRequest: async () => ({
        ok: true,
        data: { entries: [same("local"), same("local"), same("external")] },
      }),
    };
    render(<CardSyncLog store={store as never} hostId="h" cardId="c" />);
    await waitFor(() => expect(screen.queryAllByRole("listitem")).toHaveLength(3));
  });
});
