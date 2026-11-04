import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { SessionHeader } = await import("../src/components/session/parts.tsx");

/** Reports a width to every box that is observed, as a real layout would. */
let width: number | null = null;
const real = globalThis.ResizeObserver;
beforeEach(() => {
  if (width === null) return;
  const w = width;
  globalThis.ResizeObserver = class {
    constructor(private readonly callback: (entries: unknown[]) => void) {}
    observe() {
      this.callback([{ contentRect: { width: w } }]);
    }
    disconnect() {}
    unobserve() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(() => {
  cleanup();
  globalThis.ResizeObserver = real;
  width = null;
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
    width = 360;
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
    width = 360;
    render(header());
    await act(async () => {});
    await act(async () => void fireEvent.click(more() as HTMLElement));
    expect(screen.queryByRole("button", { name: "End" })).not.toBeNull();
    expect(screen.queryByText("persona controls")).not.toBeNull();
  });
});
