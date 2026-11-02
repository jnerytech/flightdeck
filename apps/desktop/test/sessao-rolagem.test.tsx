import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { SessionView } = await import("../src/ui/SessionView.tsx");
const { RecapPanel } = await import("../src/ui/RecapPanel.tsx");
const { emptySession } = await import("../src/lib/session-state.ts");

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
    set: (v: number) => void (size.top = v),
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
    const composer = screen.queryByRole("textbox", { name: /./ })?.parentElement;
    expect(composer?.className).toContain("shrink-0");
  });

  test("a new message follows the end when you were at the end", async () => {
    const { rerender } = render(view(3));
    const s = scroller({ scroll: 1000, client: 400, top: 600 });
    await act(async () => void fireEvent.scroll(s.el));
    s.size.scroll = 1100;
    rerender(view(4));
    await act(async () => {});
    expect(s.size.top).toBe(1100);
    expect(screen.queryByRole("button", { name: "Jump to latest" })).toBeNull();
  });

  test("a new message leaves you where you were reading, and offers Jump to latest", async () => {
    const { rerender } = render(view(3));
    const s = scroller({ scroll: 1000, client: 400, top: 100 });
    await act(async () => void fireEvent.scroll(s.el));
    s.size.scroll = 1100;
    rerender(view(4));
    await act(async () => {});
    expect(s.size.top).toBe(100);
    const jump = screen.queryByRole("button", { name: "Jump to latest" });
    expect(jump).not.toBeNull();
    await act(async () => void fireEvent.click(jump as HTMLElement));
    expect(s.size.top).toBe(1100);
    expect(screen.queryByRole("button", { name: "Jump to latest" })).toBeNull();
  });
});

describe("sessao-rolagem: the summary does not push the conversation away", () => {
  const state = { hosts: [{ id: "h", hostInfo: { features: ["summary"] } }] };
  const store = (calls: string[]) =>
    ({
      subscribe: () => () => {},
      getState: () => state,
      sessionRecap: async () => {
        calls.push("recap");
        return { asked: "a thing", done: "it", files: [], filesMore: 0, costUsd: null, question: null };
      },
      copyText: async () => {},
    }) as never;

  test("it opens the first time a session is seen and starts collapsed after that", async () => {
    const calls: string[] = [];
    const mount = () =>
      render(<RecapPanel store={store(calls)} hostId="h" claudeSessionId="c-1" />);
    mount();
    await act(async () => {});
    expect(screen.queryByText("a thing")).not.toBeNull();
    cleanup();
    mount();
    await act(async () => {});
    expect(screen.queryByText("a thing")).toBeNull();
    const toggle = screen.queryByRole("button", { name: /Session summary/ });
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    await act(async () => void fireEvent.click(toggle as HTMLElement));
    expect(screen.queryByText("a thing")).not.toBeNull();
  });
});
