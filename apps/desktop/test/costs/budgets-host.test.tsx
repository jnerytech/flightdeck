import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { seedDemoHosts } from "../../src/demo/boot.ts";
import { liveScreen, registerDom } from "../dom.ts";
import { daemon as makeDaemon, memoryPlatform, seedHosts, TOKEN } from "../fixtures.ts";
import { legacyDaemon } from "../legacy-daemon.ts";
import { settle, settleMaybe } from "../wait.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { App } = await import("../../src/app/App.tsx");
const { BudgetsSection } = await import("../../src/features/costs/ui.ts");
const { TContext } = await import("../../src/i18n/context.tsx");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** The app on `kinds`: hosts alfa, beta... that report costs, or one that does not (an old daemon). */
async function setup(kinds: Array<"costs" | "legacy">) {
  const names = ["alfa", "beta", "gama"];
  const platform = memoryPlatform(false);
  seedDemoHosts(
    platform.win.localStorage,
    platform.tokens,
    kinds.map((kind, i) => ({
      id: `h${i}`,
      name: names[i] ?? "",
      url: (kind === "costs"
        ? makeDaemon(cleanups, { costs: true }).listen()
        : legacyDaemon(cleanups)
      ).url,
      token: TOKEN,
    })),
  );
  const store = new AppStore(platform.platform, { baseDelayMs: 60_000 });
  render(<App store={store} />);
  await settle(
    () =>
      store.getState().hosts.length === kinds.length &&
      store.getState().hosts.every((h) => h.hostInfo != null),
  );
  return { store };
}

const setBudget = () => screen.queryByRole("button", { name: "Definir um orçamento" });
const heading = (host: string) => screen.queryByRole("button", { name: `Orçamentos de ${host}` });
const panels = () =>
  [...document.querySelectorAll("section[aria-label^='Orçamentos de ']")].map((s) =>
    s.getAttribute("aria-label"),
  );
const formOf = (host: string) => screen.queryByRole("form", { name: `Novo orçamento em ${host}` });

describe("budgets by host (#3912)", () => {
  test("Definir um orçamento on a host's Costs opens Settings with that host", async () => {
    const { store } = await setup(["costs", "costs"]);
    await act(async () => store.router.push({ name: "costs", host: "h1" }));
    await settle(() => setBudget() !== null);
    await act(async () => {
      fireEvent.click(setBudget() as HTMLElement);
    });
    expect(store.router.current).toEqual({ name: "settings", section: "budgets", host: "h1" });
  });

  test("across every host the route names no host", async () => {
    const { store } = await setup(["costs", "costs"]);
    await act(async () => store.router.push({ name: "costs", host: "__all__" }));
    await settle(() => setBudget() !== null);
    await act(async () => {
      fireEvent.click(setBudget() as HTMLElement);
    });
    expect(store.router.current).toEqual({ name: "settings", section: "budgets" });
    expect(Object.hasOwn(store.router.current, "host")).toBe(false);
  });

  test("with no host able to hold budgets Costs does not offer to set one", async () => {
    const { store } = await setup(["legacy"]);
    await act(async () => store.router.push({ name: "costs" }));
    await settle(() => screen.queryByRole("heading", { name: "Custos" }) !== null);
    expect(screen.queryByRole("heading", { name: "Custos" })).not.toBeNull();
    expect(setBudget()).toBeNull();
  });

  test("Settings opens on the host being read: its panel first and open, the others folded, its heading focused", async () => {
    const { store } = await setup(["costs", "costs"]);
    await act(async () => store.router.push({ name: "settings", section: "budgets", host: "h1" }));
    await settle(() => panels().length === 2);
    expect(panels()).toEqual(["Orçamentos de beta", "Orçamentos de alfa"]);
    expect(heading("beta")?.getAttribute("aria-expanded")).toBe("true");
    expect(heading("alfa")?.getAttribute("aria-expanded")).toBe("false");
    expect(formOf("beta")).not.toBeNull();
    expect(formOf("alfa")).toBeNull();
    await settleMaybe(() => document.activeElement === heading("beta"));
    expect(document.activeElement === heading("beta")).toBe(true); // NOSONAR: a DOM node in a failed toBe would print the page
  });

  test("with no host the panels are in order, all folded, and the first heading is focused", async () => {
    const { store } = await setup(["costs", "costs"]);
    await act(async () => store.router.push({ name: "settings", section: "budgets" }));
    await settle(() => panels().length === 2);
    expect(panels()).toEqual(["Orçamentos de alfa", "Orçamentos de beta"]);
    expect(heading("alfa")?.getAttribute("aria-expanded")).toBe("false");
    expect(heading("beta")?.getAttribute("aria-expanded")).toBe("false");
    await settleMaybe(() => document.activeElement === heading("alfa"));
    expect(document.activeElement === heading("alfa")).toBe(true); // NOSONAR: a DOM node in a failed toBe would print the page
  });

  test("pressing a folded heading opens its panel, and each form's name carries its host", async () => {
    const { store } = await setup(["costs", "costs"]);
    await act(async () => store.router.push({ name: "settings", section: "budgets" }));
    await settle(() => panels().length === 2);
    expect(formOf("alfa")).toBeNull();
    expect(heading("alfa")).not.toBeNull();
    expect(heading("beta")).not.toBeNull();
    await act(async () => {
      fireEvent.click(heading("alfa") as HTMLElement);
      fireEvent.click(heading("beta") as HTMLElement);
    });
    expect(heading("alfa")?.getAttribute("aria-expanded")).toBe("true");
    expect(formOf("alfa")).not.toBeNull();
    expect(formOf("beta")).not.toBeNull();
  });

  test("one host's panel has no fold: it stays open and has no heading button", async () => {
    const { store } = await setup(["costs", "legacy"]);
    await act(async () => store.router.push({ name: "settings", section: "budgets" }));
    await settle(() => panels().length === 1);
    expect(formOf("alfa")).not.toBeNull();
    expect(heading("alfa")).toBeNull();
  });

  test("an open panel stays open when a second host makes the panels fold", async () => {
    const store = new AppStore(memoryPlatform(false, "pt-BR").platform, { baseDelayMs: 600_000 });
    seedHosts(store, [{ id: "h1", name: "alfa", online: true, features: ["costs"] }]);
    const section = (fold: { open: boolean } | null) => (
      <TContext.Provider value={store.i18n.t}>
        <BudgetsSection store={store} hostId="h1" hostName="alfa" budgets={[]} fold={fold} />
      </TContext.Provider>
    );
    const view = render(section(null));
    expect(formOf("alfa")).not.toBeNull();
    view.rerender(section({ open: false }));
    expect(formOf("alfa")).not.toBeNull();
    // Navigating to another host's panel is a choice: this one folds.
    view.rerender(section({ open: true }));
    view.rerender(section({ open: false }));
    expect(formOf("alfa")).toBeNull();
  });
});
