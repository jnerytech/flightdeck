import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { waiter } from "./wait.ts";

registerDom();
const { act, cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);
afterEach(() => cleanup());

describe("toast-sozinho: a toast that nobody closes leaves by itself", () => {
  test("an error goes after its lifetime, and leaves the notice list too", async () => {
    const store = new AppStore(memoryPlatform(false, "en-US").platform, { baseDelayMs: 60_000 });
    render(<App store={store} />);
    await act(async () => {
      store.reportError("A problem nobody closes");
    });
    const settle = waiter(15_000);
    await settle(() => screen.queryAllByRole("alert").length === 1);
    expect(store.getState().notices).toHaveLength(1);
    await settle(() => store.getState().notices.length === 0);
    await settle(() => screen.queryAllByRole("alert").length === 0);
    store.dispose();
  });
});
