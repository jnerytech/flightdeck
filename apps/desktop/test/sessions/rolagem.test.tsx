import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { readStyles } from "../../../../scripts/lib/styles/styles-source.ts";
import { liveScreen, registerDom } from "../dom.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");

/** The person scrolls: the wheel, then the scroll event the browser sends for it. */
const personScrolls = (el: Element) => {
  fireEvent.wheel(el, { deltaY: -120 });
  fireEvent.scroll(el);
};
const screen = liveScreen(within);
const { SessionView } = await import("../../src/features/sessions/session-view.tsx");
const { emptySession } = await import("../../src/features/sessions/session-state.ts");

afterEach(cleanup);

const actions = {
  send: async () => {},
  interrupt: async () => {},
  close: async () => {},
  resume: async () => {},
  respond: async () => {},
};
const withItems = (n: number) => ({
  ...emptySession(),
  status: "idle" as const,
  items: Array.from({ length: n }, (_, i) => ({
    kind: "user" as const,
    seq: i + 1,
    text: `message ${i + 1}`,
  })),
});
const view = (n: number) => <SessionView title="s" session={withItems(n)} actions={actions} />;

/** The scroller, with the sizes a browser would give it (the test DOM has no layout). */
function scroller(height: { scroll: number; client: number; top: number }) {
  const el = document.querySelector<HTMLElement>("[tabindex='0'].overflow-y-auto") as HTMLElement;
  expect(el).not.toBeNull();
  const size = { ...height };
  Object.defineProperty(el, "scrollHeight", { get: () => size.scroll, configurable: true });
  Object.defineProperty(el, "clientHeight", { get: () => size.client, configurable: true });
  Object.defineProperty(el, "scrollTop", {
    get: () => size.top,
    set: (v: number) => {
      size.top = v;
    },
    configurable: true,
  });
  return { el, size };
}

describe("sessao-rolagem: the conversation is the one scroll area of the session", () => {
  test("the header, the composer and the messages never shrink, so nothing overlaps", () => {
    render(view(3));
    const el = document.querySelector("[tabindex='0'].overflow-y-auto") as HTMLElement;
    expect(el.className).toContain("[&>*]:shrink-0");
    expect(document.querySelector("header")?.className).toContain("shrink-0");
    const dock = screen
      .queryByRole("textbox", { name: /./ })
      ?.closest("[data-slot='composer-card']")?.parentElement;
    expect(dock?.className).toContain("composer-dock");
    // The utility is what keeps the dock from shrinking.
    expect(readStyles(join(import.meta.dir, "../../src/styles.css"))).toMatch(
      /@utility composer-dock \{[^}]*flex-shrink: 0/,
    );
  });

  test("a new message follows the end when you were at the end", async () => {
    const { rerender } = render(view(3));
    const s = scroller({ scroll: 1000, client: 400, top: 600 });
    await act(async () => void personScrolls(s.el));
    s.size.scroll = 1100;
    rerender(view(4));
    await act(async () => {});
    expect(s.size.top).toBe(1100);
    expect(screen.queryByRole("button", { name: "Ir para a última" })).toBeNull();
  });
});
