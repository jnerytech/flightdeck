import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { SessionHeader, SessionPane } = await import("../src/components/session/parts.tsx");

/** Reports a width to every box that is observed, as a real layout would. */
const real = globalThis.ResizeObserver;
function layoutWidth(width: number) {
  globalThis.ResizeObserver = class {
    constructor(private readonly callback: (entries: unknown[]) => void) {}
    observe() {
      this.callback([{ contentRect: { width } }]);
    }
    disconnect() {}
    unobserve() {}
  } as unknown as typeof ResizeObserver;
}
/** Reports a width and a height to every box that is observed (the header and its area). */
function layoutBox(width: number, height: number) {
  globalThis.ResizeObserver = class {
    constructor(private readonly callback: (entries: unknown[]) => void) {}
    observe() {
      this.callback([{ contentRect: { width, height } }]);
    }
    disconnect() {}
    unobserve() {}
  } as unknown as typeof ResizeObserver;
}
afterEach(() => {
  cleanup();
  globalThis.ResizeObserver = real;
});

const header = () => (
  <SessionHeader
    title="Revisão do PR 128"
    subtitle={<span>/tmp/alfa/projects/flightdeck-web</span>}
    hint="/tmp/alfa/projects/flightdeck-web · US$ 0.00"
    controls={<span>idle</span>}
    actions={<button type="button">End</button>}
    dialogs={<p>confirm dialog</p>}
    extra={<p>persona controls</p>}
  />
);
const more = () => screen.queryByRole("button", { name: "Mais ações" });

describe("sessao-cabecalho: the session header at narrow widths", () => {
  test("wide: the path, the buttons and the persona row are all in the header", async () => {
    render(header());
    expect(more()).toBeNull();
    expect(screen.queryByText("/tmp/alfa/projects/flightdeck-web")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "End" })).not.toBeNull();
    expect(screen.queryByText("persona controls")).not.toBeNull();
    expect(screen.queryByText("confirm dialog")).not.toBeNull();
  });

  test("narrow: one line with the title and the status, the path in the tooltip, the rest in a menu", async () => {
    layoutWidth(360);
    render(header());
    await act(async () => {});
    expect(screen.getByRole("heading", { name: "Revisão do PR 128" }).getAttribute("title")).toBe(
      "/tmp/alfa/projects/flightdeck-web · US$ 0.00",
    );
    expect(screen.queryByText("/tmp/alfa/projects/flightdeck-web")).toBeNull();
    expect(screen.queryByText("idle")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "End" })).toBeNull();
    expect(screen.queryByText("persona controls")).toBeNull();
    // A dialog of an action lives on whether the menu is open or not.
    expect(screen.queryByText("confirm dialog")).not.toBeNull();
  });

  test("narrow: the menu holds the buttons and the persona row", async () => {
    layoutWidth(360);
    render(header());
    await act(async () => {});
    await act(async () => void fireEvent.click(more() as HTMLElement));
    expect(screen.queryByRole("button", { name: "End" })).not.toBeNull();
    expect(screen.queryByText("persona controls")).not.toBeNull();
  });
});

// Issue #232: at 720x480 the header was wide enough for its full layout, and it left the
// conversation 116 px. A short area takes the one-line header, whatever its width.
describe("sessao-cabecalho: the session header in a short area", () => {
  test("in an area under 600 px high the header is one line even when it is wide", async () => {
    layoutBox(664, 480);
    render(<SessionPane>{header()}</SessionPane>);
    await act(async () => {});
    expect(more()).not.toBeNull();
    expect(screen.queryByText("/tmp/alfa/projects/flightdeck-web")).toBeNull();
  });

  test("a tall area keeps the full header at the same width", async () => {
    layoutBox(664, 800);
    render(<SessionPane>{header()}</SessionPane>);
    await act(async () => {});
    expect(more()).toBeNull();
    expect(screen.queryByText("/tmp/alfa/projects/flightdeck-web")).not.toBeNull();
  });
});
