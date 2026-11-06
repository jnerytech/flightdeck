import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { registerDom } from "./dom.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");

/** The person scrolls: the wheel, then the scroll event the browser sends for it. */
const personScrolls = (el: Element) => {
  fireEvent.wheel(el, { deltaY: -120 });
  fireEvent.scroll(el);
};
const { SessionView } = await import("../src/ui/SessionView.tsx");
const { emptySession } = await import("../src/lib/session-state.ts");

/** A ResizeObserver the test drives: `grow()` is a layout change (an image, a code block, a panel). */
const observers: Array<() => void> = [];
class FakeResizeObserver {
  constructor(private readonly callback: (entries: unknown[]) => void) {
    // The app's other observers (the width of a region) read the entry's size: give them one.
    observers.push(() =>
      this.callback([{ contentRect: { width: 1000, height: 800 }, target: document.body }]),
    );
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}
const grow = () =>
  act(async () => {
    for (const fire of observers) fire();
  });

let original: unknown;
beforeEach(() => {
  observers.length = 0;
  original = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;
});
afterEach(() => {
  cleanup();
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = original;
});

const actions = {
  send: async () => {},
  interrupt: async () => {},
  close: async () => {},
  resume: async () => {},
  respond: async () => {},
};
/** `n` messages numbered from `first`: a lower `first` is older history prepended. */
const items = (n: number, first = 1) =>
  Array.from({ length: n }, (_, i) => ({
    kind: "user" as const,
    seq: first + i,
    text: `message ${first + i}`,
  }));
const view = (list: ReturnType<typeof items>, scrollKey?: string) => (
  <SessionView
    title="s"
    session={{ ...emptySession(), status: "idle" as const, items: list }}
    actions={actions}
    {...(scrollKey ? { scrollKey } : {})}
  />
);

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

describe("sessao-rolagem-fim: opening lands on the latest message", () => {
  test("content that grows after the first paint (images, code, a panel) keeps the end in view", async () => {
    render(view(items(20)));
    const s = scroller({ scroll: 1000, client: 400, top: 600 });
    s.size.scroll = 1800;
    await grow();
    expect(s.size.top).toBe(1800);
    // The summary panel taking room above shrinks the conversation: still at the end.
    s.size.client = 300;
    s.size.scroll = 1900;
    await grow();
    expect(s.size.top).toBe(1900);
  });

  test("the scroll event of the view's own jump to the end, read after the layout grew, is not the person leaving", async () => {
    render(view(items(20)));
    const s = scroller({ scroll: 1000, client: 400, top: 0 });
    await grow();
    expect(s.size.top).toBe(1000);
    // The browser delivers that scroll event a frame later, when a panel has already grown the content.
    s.size.scroll = 1800;
    await act(async () => void personScrolls(s.el));
    expect(screen.queryByRole("button", { name: /Jump to latest|Ir para a última/ })).toBeNull();
    await grow();
    expect(s.size.top).toBe(1800);
  });

  test("a scroll event the browser sends for its own clamp, delivered after a panel took room, is not the person leaving", async () => {
    render(view(items(20)));
    const s = scroller({ scroll: 1000, client: 400, top: 0 });
    await grow();
    expect(s.size.top).toBe(1000);
    // The last turn ends: the "working" rows go, the content shrinks and the browser pulls the
    // position back (no event yet). The summary card then takes room above the conversation.
    s.size.scroll = 940;
    s.size.top = 540;
    s.size.client = 250;
    // The event for that clamp reaches the handler only now: 150 px from the end, no one touched anything.
    await act(async () => void fireEvent.scroll(s.el));
    expect(screen.queryByRole("button", { name: /Jump to latest|Ir para a última/ })).toBeNull();
    // The view still follows the end, so the next layout change pins it again.
    await grow();
    expect(s.size.top).toBe(940);
  });

  test("the person's own scroll away from the end is still the person leaving: the wheel says so", async () => {
    render(view(items(20)));
    const s = scroller({ scroll: 1000, client: 400, top: 0 });
    await grow();
    s.size.top = 300;
    await act(async () => void personScrolls(s.el));
    expect(
      screen.queryByRole("button", { name: /Jump to latest|Ir para a última/ }),
    ).not.toBeNull();
    s.size.scroll = 1400;
    await grow();
    expect(s.size.top).toBe(300);
  });

  test("the keyboard and a touch drag leave the end too, and a click on the scrollbar", async () => {
    for (const intent of [
      (el: Element) => fireEvent.keyDown(el, { key: "PageUp" }),
      (el: Element) => fireEvent.touchMove(el),
      (el: Element) => fireEvent.pointerDown(el),
    ]) {
      const { unmount } = render(view(items(20)));
      const s = scroller({ scroll: 1000, client: 400, top: 0 });
      await grow();
      s.size.top = 200;
      await act(async () => {
        intent(s.el);
        fireEvent.scroll(s.el);
      });
      expect(
        screen.queryByRole("button", { name: /Jump to latest|Ir para a última/ }),
      ).not.toBeNull();
      unmount();
    }
  });

  test("once the person scrolled up, growth leaves the view where it is", async () => {
    render(view(items(20)));
    const s = scroller({ scroll: 1000, client: 400, top: 100 });
    await act(async () => void personScrolls(s.el));
    s.size.scroll = 1800;
    await grow();
    expect(s.size.top).toBe(100);
  });

  test("new messages while scrolled up are counted on the button, which goes to the end and resets", async () => {
    const { rerender } = render(view(items(20)));
    const s = scroller({ scroll: 1000, client: 400, top: 100 });
    await act(async () => void personScrolls(s.el));
    s.size.scroll = 1100;
    rerender(view(items(21)));
    await act(async () => {});
    expect(screen.queryByRole("button", { name: "Ir para a última (1 nova)" })).not.toBeNull();
    s.size.scroll = 1300;
    rerender(view(items(23)));
    await act(async () => {});
    const jump = screen.queryByRole("button", { name: "Ir para a última (3 novas)" });
    expect(jump).not.toBeNull();
    await act(async () => void fireEvent.click(jump as HTMLElement));
    expect(s.size.top).toBe(1300);
    expect(screen.queryByRole("button", { name: /Ir para a última/ })).toBeNull();
  });
});

describe("sessao-rolagem-fim: coming back to a tab", () => {
  test("a reader who had scrolled up gets their own position back, with the jump button", async () => {
    const first = render(view(items(20), "h/s1"));
    const s = scroller({ scroll: 2000, client: 400, top: 300 });
    await act(async () => void personScrolls(s.el));
    first.unmount();
    render(view(items(20), "h/s1"));
    const back = document.querySelector<HTMLElement>(
      "[tabindex='0'].overflow-y-auto",
    ) as HTMLElement;
    expect(back.scrollTop).toBe(300);
    expect(screen.queryByRole("button", { name: "Ir para a última" })).not.toBeNull();
  });

  test("a place restored while the content is still short survives: the browser's clamp is not the reader going to the end (#515)", async () => {
    const first = render(view(items(20), "h/s515"));
    const s = scroller({ scroll: 2000, client: 400, top: 300 });
    await act(async () => void personScrolls(s.el));
    first.unmount();
    // A layout the browser has at mount: the content is only 500 px tall (the images and code blocks
    // have not laid out), so it clamps any scrollTop to 100. It is there before the view mounts.
    const layout = { scroll: 500, client: 400, top: 0 };
    const proto = HTMLElement.prototype;
    const saved = ["scrollHeight", "clientHeight", "scrollTop"].map(
      (name) => [name, Object.getOwnPropertyDescriptor(proto, name)] as const,
    );
    const mine = (el: unknown) =>
      (el as HTMLElement).matches?.("[tabindex='0'].overflow-y-auto") === true;
    Object.defineProperty(proto, "scrollHeight", {
      get() {
        return mine(this) ? layout.scroll : 0;
      },
      configurable: true,
    });
    Object.defineProperty(proto, "clientHeight", {
      get() {
        return mine(this) ? layout.client : 0;
      },
      configurable: true,
    });
    Object.defineProperty(proto, "scrollTop", {
      get() {
        return mine(this) ? layout.top : 0;
      },
      set(value: number) {
        if (mine(this)) layout.top = Math.max(0, Math.min(value, layout.scroll - layout.client));
      },
      configurable: true,
    });
    try {
      render(view(items(20), "h/s515"));
      const box = document.querySelector<HTMLElement>("[tabindex='0'].overflow-y-auto");
      expect(box).not.toBeNull();
      // The restore asked for 300 and the clamp gave 100; the browser tells the view so.
      await act(async () => void fireEvent.scroll(box as HTMLElement));
      // The code blocks lay out: the content is tall now.
      layout.scroll = 2000;
      await grow();
      expect(layout.top).toBe(300);
      expect(screen.queryByRole("button", { name: "Ir para a última" })).not.toBeNull();
    } finally {
      for (const [name, descriptor] of saved) {
        if (descriptor) Object.defineProperty(proto, name, descriptor);
        else delete (proto as unknown as Record<string, unknown>)[name];
      }
    }
  });

  test("a reader who was at the end comes back to the end, even if the content grew meanwhile", async () => {
    const first = render(view(items(20), "h/s2"));
    const s = scroller({ scroll: 1000, client: 400, top: 600 });
    await act(async () => void personScrolls(s.el));
    first.unmount();
    render(view(items(22), "h/s2"));
    const back = scroller({ scroll: 1200, client: 400, top: 0 });
    await grow();
    expect(back.size.top).toBe(1200);
    expect(screen.queryByRole("button", { name: /Ir para a última/ })).toBeNull();
  });

  test("another conversation does not inherit the position", async () => {
    const first = render(view(items(20), "h/s3"));
    const s = scroller({ scroll: 2000, client: 400, top: 300 });
    await act(async () => void personScrolls(s.el));
    first.unmount();
    render(view(items(20), "h/other"));
    const back = scroller({ scroll: 1500, client: 400, top: 0 });
    await grow();
    expect(back.size.top).toBe(1500);
  });
});

describe("sessao-rolagem-fim: the places kept are bounded", () => {
  test("after 200 conversations the oldest place is forgotten and the newest is kept", async () => {
    for (let i = 0; i <= 200; i++) {
      const first = render(view(items(3), `cap/${i}`));
      const s = scroller({ scroll: 2000, client: 400, top: 300 });
      await act(async () => void personScrolls(s.el));
      first.unmount();
    }
    // The first one was pushed out: it opens at the end, as a conversation seen for the first time.
    render(view(items(3), "cap/0"));
    const forgotten = scroller({ scroll: 1500, client: 400, top: 0 });
    await grow();
    expect(forgotten.size.top).toBe(1500);
    cleanup();
    // The last one is still where its reader left it.
    render(view(items(3), "cap/200"));
    const kept = document.querySelector<HTMLElement>("[tabindex='0'].overflow-y-auto");
    expect(kept?.scrollTop).toBe(300);
  });
});

describe("sessao-rolagem-fim: older messages loaded above", () => {
  test("prepending history keeps what the reader was looking at", async () => {
    const { rerender } = render(view(items(10, 11)));
    const s = scroller({ scroll: 1000, client: 400, top: 500 });
    await act(async () => void personScrolls(s.el));
    s.size.scroll = 1400;
    rerender(view(items(20, 1)));
    await act(async () => {});
    expect(s.size.top).toBe(900);
    expect(screen.queryByRole("button", { name: /Ir para a última \(/ })).toBeNull();
  });
});
