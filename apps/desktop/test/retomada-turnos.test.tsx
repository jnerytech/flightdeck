import { afterEach, describe, expect, test } from "bun:test";
import type { HistoryMessage } from "@flightdeck/protocol";
import { registerDom } from "./dom.ts";
import { waiter } from "./wait.ts";

registerDom();
const { act, cleanup, render, screen } = await import("@testing-library/react");
const { EarlierTurns } = await import("../src/components/session/earlier-turns.tsx");
const { translator } = await import("../src/i18n/index.ts");

afterEach(cleanup);
const settle = waiter(2000);

const message = (n: number, role: "user" | "assistant" = "user"): HistoryMessage => ({
  uuid: `m${n}`,
  ts: null,
  role,
  kind: "message",
  text: `turno ${n}`,
});

/** A store that answers `history.get` from `pages`, in order, and counts the asks. */
function fakeStore(pages: Array<{ messages: HistoryMessage[]; nextCursor: string | null }>) {
  const asked: Array<{ cursor?: string }> = [];
  const i18n = { t: translator("en") };
  const store = {
    i18n,
    hostRequest: async (_host: string, _type: string, payload: { cursor?: string }) => {
      asked.push(payload);
      const page = pages[Math.min(asked.length - 1, pages.length - 1)];
      return { ok: true, data: { session: {}, ...page, prevCursor: null } };
    },
  };
  return { store: store as never, asked };
}

describe("retomada-turnos: the earlier turns of a resumed session", () => {
  test("a transcript with no messages says so, instead of a blank pane", async () => {
    const { store } = fakeStore([{ messages: [], nextCursor: null }]);
    render(<EarlierTurns store={store} hostId="h" claudeSessionId="c" />);
    await settle(() => screen.queryByText(/no earlier turns/) !== null);
    expect(screen.getByRole("region", { name: "Before resuming" })).toBeTruthy();
  });

  test("only messages count (a summary line does not), and a long transcript is cut with a note", async () => {
    const page = (from: number) => ({
      messages: [
        ...Array.from({ length: 50 }, (_, i) => message(from + i)),
        { ...message(999), kind: "summary" as const, text: "resumo" },
      ],
      nextCursor: "next",
    });
    const { store, asked } = fakeStore([page(0), page(50), page(100), page(150), page(200)]);
    render(<EarlierTurns store={store} hostId="h" claudeSessionId="c" />);
    await settle(() => screen.queryByText(/Only the first 200 earlier turns/) !== null);
    expect(screen.queryByText("resumo")).toBeNull();
    expect(screen.queryByText("turno 199")).not.toBeNull();
    expect(screen.queryByText("turno 200")).toBeNull();
    expect(asked.map((a) => a.cursor)).toEqual([undefined, "next", "next", "next"]);
  });

  test("unmounted before the answer, it shows nothing and does not fail", async () => {
    const { store, asked } = fakeStore([{ messages: [message(1)], nextCursor: null }]);
    const view = render(<EarlierTurns store={store} hostId="h" claudeSessionId="c" />);
    view.unmount();
    await act(async () => {
      await Bun.sleep(20);
    });
    expect(asked.length).toBe(1);
    expect(screen.queryByText("turno 1")).toBeNull();
  });
});
