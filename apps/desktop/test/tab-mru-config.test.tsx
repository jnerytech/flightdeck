import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settle } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

afterEach(() => cleanup());

describe("tab-mru-config: the Ctrl+Tab order is a setting (issue #148)", () => {
  test("Settings offers most recently used by default and Tab order, and keeps the choice", async () => {
    const mem = memoryPlatform();
    const store = new AppStore(mem.platform);
    render(<App store={store} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Configurações" }));
    });
    await settle(() => screen.queryByLabelText("Ordem do Ctrl+Tab") !== null);
    const select = screen.getByLabelText("Ordem do Ctrl+Tab") as HTMLSelectElement;
    expect(select.value).toBe("mru");
    expect([...select.options].map((o) => o.textContent)).toEqual([
      "Mais recente primeiro",
      "Ordem das abas",
    ]);
    await act(async () => {
      fireEvent.change(select, { target: { value: "sequential" } });
    });
    expect(store.tabOrder.value).toBe("sequential");
    expect(mem.platform.storage.getItem("flightdeck.tabOrder")).toBe("sequential");
  });
});
