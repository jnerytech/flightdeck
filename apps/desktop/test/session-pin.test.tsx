import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { registerDom } from "./dom.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { SessionView } = await import("../src/ui/SessionView.tsx");
const { emptySession } = await import("../src/lib/session-state.ts");

/** A ResizeObserver whose callbacks the test fires, as a browser does when a box changes size. */
const observers: ResizeObserverCallback[] = [];
const savedObserver = globalThis.ResizeObserver;
globalThis.ResizeObserver = class {
  constructor(callback: ResizeObserverCallback) {
    observers.push(callback);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
const resized = () =>
  act(async () => {
    for (const fire of observers) fire([], {} as ResizeObserver);
  });

afterEach(() => {
  cleanup();
  observers.length = 0;
});
// Put back for the files that run after this one in the same process.
afterAll(() => {
  globalThis.ResizeObserver = savedObserver;
});

const actions = {
  send: async () => {},
  interrupt: async () => {},
  close: async () => {},
  resume: async () => {},
  respond: async () => {},
};
const session = (withRequest: boolean) => ({
  ...emptySession(),
  status: "idle" as const,
  items: [
    { kind: "user" as const, seq: 1, text: "run the tests" },
    ...(withRequest
      ? [
          {
            kind: "permission" as const,
            seq: 2,
            requestId: "r1",
            toolName: "Bash",
            input: { command: "npm test" },
          },
        ]
      : []),
  ],
});

/** The scroller, with the sizes a browser would give it (the test DOM has no layout). */
function scroller(height: { scroll: number; client: number; top: number }) {
  const el = document.querySelector<HTMLElement>("[data-slot='timeline']") as HTMLElement;
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
const jump = () => screen.queryByRole("button", { name: "Ir para a última" });

describe("session-pin: the conversation stays at its end while you follow it", () => {
  // Issue #173: after the end was pinned, the header's summary card opened and a late row of the
  // request card appeared; the timeline changed size, the end moved away and the request was cut.
  test("a size change while at the end keeps the end in view, with no Ir para a última", async () => {
    render(<SessionView title="s" session={session(true)} actions={actions} />);
    const s = scroller({ scroll: 1000, client: 400, top: 600 });
    await act(async () => void fireEvent.scroll(s.el));
    s.size.scroll = 1080;
    s.size.client = 300;
    await resized();
    expect(s.size.top).toBe(1080);
    expect(jump()).toBeNull();
  });

  test("a size change while reading earlier leaves you where you were", async () => {
    render(<SessionView title="s" session={session(true)} actions={actions} />);
    const s = scroller({ scroll: 1000, client: 400, top: 100 });
    await act(async () => void fireEvent.scroll(s.el));
    s.size.scroll = 1080;
    await resized();
    expect(s.size.top).toBe(100);
  });

  test("a request opened from a notice comes into view whole, not centered and cut", async () => {
    const asked: unknown[] = [];
    const proto = HTMLElement.prototype as unknown as { scrollIntoView?: unknown };
    const saved = proto.scrollIntoView;
    proto.scrollIntoView = (options: unknown) => void asked.push(options);
    try {
      render(
        <SessionView title="s" session={session(true)} actions={actions} focusRequestId="r1" />,
      );
      await act(async () => {});
      expect(asked).toEqual([{ block: "nearest" }]);
    } finally {
      proto.scrollIntoView = saved;
    }
  });
});
