import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { type AxeViolation, blocking, describeViolation } from "../../../scripts/lib/axe.ts";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, render } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");
const axe = (await import("axe-core")).default;

setDefaultTimeout(30_000);
afterEach(cleanup);

/** The rules the prints' axe failed on the tab bars: a tablist holds tabs only. */
async function violations(): Promise<string[]> {
  const result = await axe.run(document.body, {
    runOnly: ["aria-required-children", "aria-required-parent", "nested-interactive"],
  });
  return blocking(result.violations as AxeViolation[]).map((v) => describeViolation("abas", v));
}

describe("abas: acessibilidade da barra de abas", () => {
  test("a tab bar with pinned, active and other tabs holds only tabs in its tablist", async () => {
    const store = new AppStore(memoryPlatform(false, "pt-BR").platform);
    render(<App store={store} />);
    await act(async () => {
      store.tabs.open({ name: "needs-you" });
      store.tabs.open({ name: "costs" });
      store.tabs.pin(store.tabs.activeId, true);
    });
    expect(await violations()).toEqual([]);
  });

  test("so do both tab bars of a split window", async () => {
    const store = new AppStore(memoryPlatform(false, "pt-BR").platform);
    render(<App store={store} />);
    await act(async () => {
      store.tabs.open({ name: "needs-you" });
      store.workspace.toggleSplit();
    });
    expect(await violations()).toEqual([]);
  });
});
