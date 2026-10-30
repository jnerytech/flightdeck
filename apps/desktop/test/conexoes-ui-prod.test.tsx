import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

afterEach(cleanup);

/**
 * The app with its first tab active and a second tab on the terminal of a host that is not
 * connected; `ssh` says that terminal was opened from a ssh destino with those tags.
 */
async function setup(ssh?: { name: string; tags: string[] }) {
  const store = new AppStore(memoryPlatform(false, "pt-BR").platform);
  if (ssh) store.sshTerminals.set("h1/term-1", ssh);
  render(<App store={store} />);
  await act(async () => {
    store.tabs.open({ name: "terminal", host: "h1", terminalId: "term-1" });
    store.tabs.activate(store.tabs.tabs[0]?.id as string);
  });
  return store;
}

const sshTab = () => screen.queryByRole("tab", { name: /^SSH · / });
const wrapper = () => sshTab()?.parentElement ?? null;

describe("conexoes-ui: the tab of a SSH terminal", () => {
  test("the tab is named after the destino and carries its tags", async () => {
    await setup({ name: "vps", tags: ["staging", "cliente X"] });
    expect(sshTab()).not.toBeNull();
    expect(sshTab()?.textContent).toContain("SSH · vps");
    expect(sshTab()?.textContent).toContain("staging");
    expect(sshTab()?.textContent).toContain("cliente X");
  });

  test("the prod and produção tags give the tab a red border", async () => {
    await setup({ name: "vps", tags: ["prod"] });
    expect(wrapper()?.getAttribute("data-prod")).toBe("true");
    expect(wrapper()?.className).toContain("border-destructive");
    cleanup();
    await setup({ name: "vps", tags: ["Produção"] });
    expect(wrapper()?.getAttribute("data-prod")).toBe("true");
  });

  test("another tag leaves the border alone", async () => {
    await setup({ name: "lab", tags: ["staging"] });
    expect(wrapper()?.getAttribute("data-prod")).toBe("false");
    expect(wrapper()?.className).not.toContain("border-destructive");
  });

  test("a terminal tab that did not come from a destino has no badge and no mark", async () => {
    await setup();
    expect(sshTab()).toBeNull();
    expect(screen.queryByRole("tab", { name: "Terminal" })).not.toBeNull();
    expect(
      screen.queryByRole("tab", { name: "Terminal" })?.parentElement?.getAttribute("data-prod"),
    ).toBeNull();
  });
});
