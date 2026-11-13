import { describe, expect, test } from "bun:test";
import {
  Component,
  createElement,
  type ReactNode,
  Suspense,
  startTransition,
  useEffect,
  useState,
} from "react";
import { liveScreen, registerDom } from "../dom.ts";
import { settlePlain } from "../wait.ts";

registerDom();
const { act, cleanup, render, within } = await import("@testing-library/react");
const { lazyScreen, preloadAllScreens } = await import("../../src/ui/lazy-screen.ts");
const screen = liveScreen(within);

function Late() {
  return createElement("p", null, "late screen");
}

describe("lazy-screen: a preloaded screen renders at once", () => {
  test("before the preload the screen shows nothing yet, and the chunk then brings it", async () => {
    let arrive = () => {};
    // One import, however many times the loader asks for it (a real `import()` is cached too).
    const chunk = new Promise<{ Late: typeof Late }>((resolve) => {
      arrive = () => resolve({ Late });
    });
    const Screen = lazyScreen(() => chunk, "Late");
    await act(async () => {
      render(createElement(Screen));
    });
    expect(screen.queryByText("late screen")).toBeNull();
    await act(async () => {
      arrive();
    });
    expect(screen.queryByText("late screen")).not.toBeNull();
    cleanup();
  });

  test("after preloadAllScreens a screen renders in the first pass, with no waiting", async () => {
    const Screen = lazyScreen(() => Promise.resolve({ Late }), "Late");
    await preloadAllScreens();
    await act(async () => {
      render(createElement(Screen));
    });
    cleanup();
    // The same render, now synchronous: no act, no wait.
    const Again = lazyScreen(() => Promise.resolve({ Late }), "Late");
    await preloadAllScreens();
    render(createElement(Again));
    expect(screen.queryByText("late screen")).not.toBeNull();
    cleanup();
  });
});

/** Each mount and unmount of `Counted`, in order. */
const mounts: string[] = [];
function Counted(props: { label?: string }) {
  useEffect(() => {
    mounts.push("mount");
    return () => {
      mounts.push("unmount");
    };
  }, []);
  return createElement("p", null, props.label ?? "counted");
}
// A sibling that renders slowly, so React yields before it reaches the screen's own render.
function Slow() {
  const until = performance.now() + 20;
  while (performance.now() < until) {
    // busy: this is the slow machine
  }
  return null;
}
const Opened = lazyScreen(() => Promise.resolve({ Counted }), "Counted");
let open = (_label: string) => {};
function Host() {
  const [label, setLabel] = useState<string | null>(null);
  open = (next) => startTransition(() => setLabel(next));
  return createElement(
    Suspense,
    { fallback: "loading" },
    label === null ? null : createElement(Slow),
    label === null ? null : createElement(Opened, { label }),
  );
}

/** Outside act, so React slices the render like it does in the app. */
async function outsideAct(run: () => Promise<void>, ui: ReactNode) {
  const flag = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const before = flag.IS_REACT_ACT_ENVIRONMENT;
  flag.IS_REACT_ACT_ENVIRONMENT = false;
  const view = render(ui);
  try {
    await run();
  } finally {
    flag.IS_REACT_ACT_ENVIRONMENT = before;
    view.unmount();
    cleanup();
  }
}

describe("lazy-screen: a screen is never mounted twice because its chunk arrived (#1792)", () => {
  test("a screen that opened through Suspense keeps its state when its parent renders again", async () => {
    await outsideAct(async () => {
      for (const label of ["first", "second", "third"]) {
        open(label);
        await settlePlain(() => screen.queryByText(label) !== null);
      }
    }, createElement(Host));
    expect(mounts).toEqual(["mount", "unmount"]);
  });
});

class Boundary extends Component<{ children: ReactNode }, { error: string | null }> {
  override state = { error: null as string | null };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  override render() {
    return this.state.error === null
      ? this.props.children
      : createElement("p", null, `failed: ${this.state.error}`);
  }
}

describe("lazy-screen: a chunk that fails to load reaches the error boundary", () => {
  test("a rejected import shows its error instead of the loading fallback for good", async () => {
    const Broken = lazyScreen(
      () => Promise.reject<{ Late: typeof Late }>(new Error("chunk 404")),
      "Late",
    );
    const ui = createElement(
      Boundary,
      null,
      createElement(Suspense, { fallback: "loading" }, createElement(Broken)),
    );
    await outsideAct(async () => {
      await settlePlain(() => screen.queryByText("failed: chunk 404") !== null);
      expect(screen.queryByText("loading")).toBeNull();
    }, ui);
  });
});
