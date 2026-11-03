import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { poll } from "../../daemon/test/helpers.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { waiter } from "./wait.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(20_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const settle = waiter(4000);

/** One host with a session asking for Bash, so "Precisa de você" has a count. */
async function setup() {
  const d = makeDaemon(cleanups, {});
  const { sessionId } = await d.manager.create({
    cwd: d.project,
    prompt: "oi",
    name: "Gerenciada",
  });
  await poll(() => d.manager.get(sessionId).status === "idle");
  d.manager.send(sessionId, "[bash]");
  await poll(() => d.manager.pendingPermissions(sessionId).length === 1);
  const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 60_000 });
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
  });
  await settle(() => store.getState().hosts.every((h) => h.status === "online"));
  await settle(() => store.getState().hosts[0]?.sessions.length === 1);
  await settle(() => aside().textContent?.includes("1") ?? false);
}

const aside = () => screen.queryByRole("complementary", { name: "Sidebar" }) as HTMLElement;
const inAside = () => within(aside());
const collapse = async () => {
  const toggle = screen.queryByRole("button", { name: "Collapse sidebar" });
  expect(toggle).not.toBeNull();
  await act(async () => {
    fireEvent.click(toggle as HTMLElement);
  });
  expect(aside().getAttribute("data-collapsed")).toBe("true");
};

describe("barra-recolhida: the rail holds icons and nothing that overflows it", () => {
  test("expanded, the search entry keeps its Ctrl K chip and Needs you its count", async () => {
    await setup();
    expect(aside().getAttribute("data-collapsed")).toBe("false");
    expect(aside().querySelector("kbd")?.textContent).toBe("Ctrl K");
    expect(aside().querySelector("[data-slot='badge']")?.textContent).toBe("1");
  });

  test("collapsed, no chip or badge is drawn in the rail", async () => {
    await setup();
    await collapse();
    expect(aside().querySelector("kbd")).toBeNull();
    expect(aside().querySelector("[data-slot='badge']")).toBeNull();
    expect(aside().textContent).not.toContain("Ctrl");
  });

  test("collapsed, the search shortcut is in the tooltip and aria-keyshortcuts", async () => {
    await setup();
    await collapse();
    const search = inAside().queryByRole("button", { name: /^Search/ });
    expect(search).not.toBeNull();
    expect(search?.getAttribute("title")).toBe("Search (Ctrl K)");
    expect(search?.getAttribute("aria-keyshortcuts")).toBe("Control+K");
  });

  test("collapsed, Needs you says its count in its name and tooltip, and shows a dot", async () => {
    await setup();
    await collapse();
    const needs = inAside().queryByRole("button", { name: "Needs you (1)" });
    expect(needs).not.toBeNull();
    expect(needs?.getAttribute("title")).toBe("Needs you (1)");
    expect(needs?.querySelector("[data-attention]")).not.toBeNull();
  });
});
