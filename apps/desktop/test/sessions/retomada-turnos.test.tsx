import { afterEach, describe, expect, test } from "bun:test";
import type { HistoryMessage } from "@flightdeck/protocol";
import { registerDom } from "../dom.ts";
import { settleMaybe, waiter } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { EarlierTurns } = await import("../../src/features/sessions/earlier-turns.tsx");
const { translator } = await import("../../src/i18n/index.ts");

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
    expect(asked).toHaveLength(1);
    expect(screen.queryByText("turno 1")).toBeNull();
  });
});

/** A store whose `history.get` answers from `answers`, in order (the last one repeats); a null never answers. */
function scriptedStore(
  language: "en" | "pt-BR",
  answers: Array<{ ok: true; messages: HistoryMessage[] } | { ok: false; message: string } | null>,
) {
  let asked = 0;
  const store = {
    i18n: { t: translator(language) },
    hostRequest: async () => {
      const answer = answers[Math.min(asked, answers.length - 1)];
      asked += 1;
      if (answer === null) return new Promise<never>(() => {});
      if (!answer.ok) return { ok: false, code: "refused", message: answer.message };
      return {
        ok: true,
        data: { session: {}, messages: answer.messages, nextCursor: null, prevCursor: null },
      };
    },
  };
  return { store: store as never, asks: () => asked };
}

describe("retomada-turnos: loading and a failed read (#4503)", () => {
  test("while the turns load, a status line says so, in both languages", () => {
    const { store } = scriptedStore("en", [null]);
    render(<EarlierTurns store={store} hostId="h" claudeSessionId="c" />);
    const english = screen.queryByRole("status")?.textContent ?? "";
    cleanup();
    const pt = scriptedStore("pt-BR", [null]);
    render(<EarlierTurns store={pt.store} hostId="h" claudeSessionId="c" />);
    expect([english, screen.queryByRole("status")?.textContent ?? ""]).toEqual([
      "Loading the earlier turns…",
      "Carregando os turnos anteriores…",
    ]);
  });

  test("a refused read says why as an alert, with Try again, and the loading line is gone", async () => {
    const { store } = scriptedStore("en", [{ ok: false, message: "host is off" }]);
    render(<EarlierTurns store={store} hostId="h" claudeSessionId="c" />);
    const shown = await settleMaybe(() => screen.queryByRole("alert") !== null);
    expect(shown).toBe(true);
    expect(screen.queryByRole("alert")?.textContent).toBe(
      "Could not read the earlier turns: host is off",
    );
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  test("Try again reads again, and the turns replace the failure", async () => {
    const { store } = scriptedStore("en", [
      { ok: false, message: "host is off" },
      { ok: true, messages: [message(1)] },
    ]);
    render(<EarlierTurns store={store} hostId="h" claudeSessionId="c" />);
    await settleMaybe(() => screen.queryByRole("alert") !== null);
    const retry = screen.queryByRole("button", { name: "Try again" });
    expect(retry).not.toBeNull();
    fireEvent.click(retry as HTMLElement);
    const shown = await settleMaybe(() => screen.queryByText("turno 1") !== null);
    expect(shown).toBe(true);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  test("while it asks again the button stays, looks disabled, ignores a second press and the loading line replaces the failure", async () => {
    const { store, asks } = scriptedStore("en", [{ ok: false, message: "host is off" }, null]);
    render(<EarlierTurns store={store} hostId="h" claudeSessionId="c" />);
    await settleMaybe(() => screen.queryByRole("alert") !== null);
    const found = screen.queryByRole("button", { name: "Try again" });
    expect(found).not.toBeNull();
    const button = found as HTMLElement;
    button.focus();
    fireEvent.click(button);
    fireEvent.click(button);
    const pressed = {
      sameButton: screen.queryByRole("button", { name: "Try again" }) === button,
      disabled: button.getAttribute("aria-disabled"),
      focused: document.activeElement === button,
      loading: screen.queryByRole("status")?.textContent ?? "",
      alert: screen.queryByRole("alert") !== null,
      asked: asks(),
    };
    expect(pressed).toEqual({
      sameButton: true,
      disabled: "true",
      focused: true,
      loading: "Loading the earlier turns…",
      alert: false,
      asked: 2,
    });
  });

  test("the failure and Try again read in pt-BR", async () => {
    const { store } = scriptedStore("pt-BR", [{ ok: false, message: "host desligado" }]);
    render(<EarlierTurns store={store} hostId="h" claudeSessionId="c" />);
    await settleMaybe(() => screen.queryByRole("alert") !== null);
    expect(screen.queryByRole("button", { name: "Tentar de novo" })).not.toBeNull();
  });
});
