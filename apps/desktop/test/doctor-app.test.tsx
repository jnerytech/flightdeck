import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { waiter } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");
const { APP_VERSION } = await import("../src/lib/version.ts");

setDefaultTimeout(20_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const settle = waiter(4000);

async function hostPage(language: string, firstRun: boolean) {
  const d = makeDaemon(cleanups, { firstRun });
  const mem = memoryPlatform(false, language);
  const store = new AppStore(mem.platform, { baseDelayMs: 60_000 });
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  const hostId = store.getState().hosts[0]?.id ?? "";
  await act(async () => {
    store.tabs.open({ name: "host", host: hostId });
  });
  return { d, store };
}

describe("doctor-app: the check of a host, in its page", () => {
  test("a host that cannot run the doctor shows no panel", async () => {
    await hostPage("pt-BR", false);
    await settle(() => screen.queryByText("Pastas permitidas") !== null);
    expect(screen.queryByRole("button", { name: "Verificar" })).toBeNull();
  });

  test("Verificar asks the host with the app version and lists each item with a plain fix for the ones that failed", async () => {
    const { d } = await hostPage("pt-BR", true);
    await settle(() => screen.queryByRole("button", { name: "Verificar" }) !== null);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Verificar" }));
    });
    await settle(() => screen.queryByRole("list", { name: "Resultado da verificação" }) !== null);
    expect(d.doctorAsked).toEqual([APP_VERSION]);
    const items = within(
      screen.getByRole("list", { name: "Resultado da verificação" }),
    ).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]?.textContent).toContain("Pastas permitidas");
    expect(items[0]?.textContent).toContain("ok");
    expect(items[0]?.textContent).not.toContain("Como consertar");
    const claude = items[1]?.textContent ?? "";
    expect(claude).toContain("Claude Code");
    expect(claude).toContain("atenção");
    expect(claude).toContain("Como consertar: Instale o Claude Code no host e reinicie o daemon.");
    expect(screen.queryByText("Itens que precisam de atenção: 1")).not.toBeNull();
  });

  test("the same panel in English", async () => {
    await hostPage("en", true);
    await settle(() => screen.queryByRole("button", { name: "Check" }) !== null);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Check" }));
    });
    await settle(() => screen.queryByRole("list", { name: "Check results" }) !== null);
    const claude = within(screen.getByRole("list", { name: "Check results" })).getAllByRole(
      "listitem",
    )[1];
    expect(claude?.textContent).toContain("warning");
    expect(claude?.textContent).toContain(
      "How to fix: Install Claude Code on the host and restart the daemon.",
    );
    expect(screen.queryByText("Items that need attention: 1")).not.toBeNull();
  });
});
