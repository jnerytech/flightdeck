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
  test("a host that cannot run the doctor shows no health section", async () => {
    await hostPage("pt-BR", false);
    await settle(() => screen.queryByText("Informações") !== null);
    expect(screen.queryByRole("region", { name: "Saúde e dependências" })).toBeNull();
  });

  test("the host is asked by itself with the app version, and each check shows an icon and a word, with a plain fix for the ones that failed", async () => {
    const { d } = await hostPage("pt-BR", true);
    const section = await waitForSection();
    await settle(() => (section.textContent ?? "").includes("Pastas permitidas"));
    expect(d.doctorAsked).toEqual([APP_VERSION]);
    const items = within(within(section).getByRole("list", { name: "Verificações" })).getAllByRole(
      "listitem",
    );
    expect(items).toHaveLength(3);
    expect(items[0]?.textContent).toContain("Pastas permitidas");
    expect(items[0]?.textContent).toContain("OK");
    expect(items[0]?.textContent).not.toContain("Como consertar");
    const claude = items[1]?.textContent ?? "";
    expect(claude).toContain("Claude Code");
    expect(claude).toContain("Atenção");
    expect(claude).toContain("Como consertar: Instale o Claude Code no host e reinicie o daemon.");
    expect(items[1]?.querySelector("[data-slot='dep-icon']")?.getAttribute("data-icon")).toBe(
      "warning",
    );
    expect(section.textContent).toContain("Opcionais faltando: 1");
    expect(section.textContent).toContain("Verificado agora");
  });

  test("Verificar de novo asks again, and the same section in English", async () => {
    const { d } = await hostPage("en", true);
    const section = await waitForSection("Health & dependencies");
    await settle(() => (section.textContent ?? "").includes("Allowed folders"));
    await act(async () => {
      fireEvent.click(within(section).getByRole("button", { name: "Check again" }));
    });
    await settle(() => d.doctorAsked.length === 2);
    const claude = within(within(section).getByRole("list", { name: "Checks" })).getAllByRole(
      "listitem",
    )[1];
    expect(claude?.textContent).toContain("Warning");
    expect(claude?.textContent).toContain(
      "How to fix: Install Claude Code on the host and restart the daemon.",
    );
    expect(section.textContent).toContain("1 optional missing");
  });
});

async function waitForSection(name = "Saúde e dependências") {
  await settle(() => screen.queryByRole("region", { name }) !== null);
  return screen.getByRole("region", { name });
}
