import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { registerDom } from "../dom.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");

/** The person scrolls: the wheel, then the scroll event the browser sends for it. */
const personScrolls = (el: Element) => {
  fireEvent.wheel(el, { deltaY: -120 });
  fireEvent.scroll(el);
};
const { SessionView } = await import("../../src/features/sessions/session-view.tsx");
const { emptySession } = await import("../../src/features/sessions/domain/session-state.ts");

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
    await act(async () => void personScrolls(s.el));
    s.size.scroll = 1080;
    s.size.client = 300;
    await resized();
    expect(s.size.top).toBe(1080);
    expect(jump()).toBeNull();
  });

  // Issue #456: at 1280x800 in pt-BR the header and the summary left the timeline as tall as the
  // request card, and pinning the very end put the card's top 17 px above the timeline's.
  test("pinning the end never cuts a pending request's top: the view stops at the card", async () => {
    render(<SessionView title="s" session={session(true)} actions={actions} />);
    const s = scroller({ scroll: 1000, client: 400, top: 600 });
    // The browser keeps scrollTop between 0 and its end; the boxes follow the scroll.
    Object.defineProperty(s.el, "scrollTop", {
      get: () => s.size.top,
      set: (v: number) => {
        s.size.top = Math.max(0, Math.min(v, s.size.scroll - s.size.client));
      },
      configurable: true,
    });
    const BOX_TOP = 415;
    const CARD_AT = 177; // the card's offset in the content, 17 px above the end's view
    const CARD_HEIGHT = 260;
    s.el.getBoundingClientRect = () =>
      ({ top: BOX_TOP, bottom: BOX_TOP + s.size.client }) as DOMRect;
    const card = s.el.querySelector<HTMLElement>("[data-request-id]") as HTMLElement;
    card.getBoundingClientRect = () => {
      const top = BOX_TOP + CARD_AT - s.size.top;
      return { top, bottom: top + CARD_HEIGHT } as DOMRect;
    };
    await act(async () => void personScrolls(s.el));
    s.size.scroll = 454;
    s.size.client = 260;
    await resized();
    const box = s.el.getBoundingClientRect();
    const rect = card.getBoundingClientRect();
    const whole = rect.top >= box.top && rect.bottom <= box.bottom;
    expect([Math.round(rect.top), Math.round(rect.bottom), whole]).toEqual([415, 675, true]);
    expect(jump()).toBeNull();
  });

  // Issue #3407: an answered request card keeps its `data-request-id`; the end was pinned to the top of
  // the oldest one, so a following reader was put far above the new messages.
  const answered = (seq: number) => ({
    kind: "permission" as const,
    seq,
    requestId: `r${seq}`,
    toolName: "Bash",
    input: { command: "npm test" },
    resolution: { decision: "allow" as const },
  });
  const withAnswered = (extra: number) => ({
    ...emptySession(),
    status: "idle" as const,
    items: [
      { kind: "user" as const, seq: 1, text: "run the tests" },
      answered(2),
      ...Array.from({ length: extra }, (_, i) => ({
        kind: "user" as const,
        seq: 3 + i,
        text: `message ${i}`,
      })),
    ],
  });
  /** The scroller as a browser clamps it, with the card at a fixed place in the content. */
  function clamped(card: { at: number; height: number }) {
    const s = scroller({ scroll: 2000, client: 400, top: 1600 });
    Object.defineProperty(s.el, "scrollTop", {
      get: () => s.size.top,
      set: (v: number) => {
        s.size.top = Math.max(0, Math.min(v, s.size.scroll - s.size.client));
      },
      configurable: true,
    });
    const BOX_TOP = 100;
    s.el.getBoundingClientRect = () =>
      ({ top: BOX_TOP, bottom: BOX_TOP + s.size.client }) as DOMRect;
    const element = s.el.querySelector<HTMLElement>("[data-request-id]") as HTMLElement;
    element.getBoundingClientRect = () => {
      const top = BOX_TOP + card.at - s.size.top;
      return { top, bottom: top + card.height } as DOMRect;
    };
    return s;
  }

  test("an answered request far above does not hold the end: new content keeps the view at the end", async () => {
    render(<SessionView title="s" session={withAnswered(3)} actions={actions} />);
    const s = clamped({ at: 50, height: 120 });
    await act(async () => void personScrolls(s.el));
    s.size.scroll = 2100;
    await resized();
    expect(s.size.top).toBe(1700);
    expect(jump()).toBeNull();
  });

  test("opening a session with answered requests above lands on its last message", async () => {
    render(<SessionView title="s" session={withAnswered(3)} actions={actions} />);
    const s = clamped({ at: 50, height: 120 });
    // The layout settles after the first paint, as it does when a session is opened.
    s.size.top = 0;
    await resized();
    expect(s.size.top).toBe(1600);
    expect(jump()).toBeNull();
  });

  test("expanding a tool card while following grows the content and the view stays at the end", async () => {
    render(<SessionView title="s" session={withAnswered(3)} actions={actions} />);
    const s = clamped({ at: 50, height: 120 });
    await act(async () => void personScrolls(s.el));
    // The card opens: the content is 300 px taller, as the observer reports it.
    s.size.scroll = 2300;
    await resized();
    expect(s.size.top).toBe(1900);
  });

  test("expanding a tool card while reading earlier keeps the reader's place", async () => {
    render(<SessionView title="s" session={withAnswered(3)} actions={actions} />);
    const s = clamped({ at: 50, height: 120 });
    s.size.top = 800;
    await act(async () => void personScrolls(s.el));
    s.size.scroll = 2300;
    await resized();
    expect(s.size.top).toBe(800);
  });

  test("a request answered while following keeps the view at the end when the next message comes", async () => {
    const waiting = {
      ...emptySession(),
      status: "idle" as const,
      items: [
        { kind: "user" as const, seq: 1, text: "run the tests" },
        { ...answered(2), resolution: undefined },
      ],
    };
    const view = render(<SessionView title="s" session={waiting} actions={actions} />);
    const s = clamped({ at: 50, height: 120 });
    await act(async () => void personScrolls(s.el));
    const next = withAnswered(2);
    await act(async () => {
      s.size.scroll = 2200;
      view.rerender(<SessionView title="s" session={next} actions={actions} />);
    });
    expect(s.size.top).toBe(1800);
  });

  test("a size change while reading earlier leaves you where you were", async () => {
    render(<SessionView title="s" session={session(true)} actions={actions} />);
    const s = scroller({ scroll: 1000, client: 400, top: 100 });
    await act(async () => void personScrolls(s.el));
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
