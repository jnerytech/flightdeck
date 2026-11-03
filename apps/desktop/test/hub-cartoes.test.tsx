import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { git } from "../../daemon/test/board-helpers.ts";
import { poll } from "../../daemon/test/helpers.ts";
import { HUB_VIEW_KEY, loadHubView, saveHubView } from "../src/lib/hub.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { settle } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { SessionCard } = await import("../src/components/hub/session-card.tsx");
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const storage = (initial?: string) => {
  const items = new Map<string, string>(initial === undefined ? [] : [[HUB_VIEW_KEY, initial]]);
  return {
    items,
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
  };
};

describe("hub-cartoes: the view is remembered", () => {
  test("the list is the default; a stored view is read back; anything else is the list", () => {
    expect(loadHubView(storage())).toBe("list");
    expect(loadHubView(storage("cards"))).toBe("cards");
    expect(loadHubView(storage("list"))).toBe("list");
    expect(loadHubView(storage("grid"))).toBe("list");
  });

  test("saving keeps the view under its key", () => {
    const s = storage();
    saveHubView(s, "cards");
    expect(s.items.get(HUB_VIEW_KEY)).toBe("cards");
    expect(loadHubView(s)).toBe("cards");
  });
});

describe("hub-cartoes: a session card", () => {
  const card = (patch: Partial<Parameters<typeof SessionCard>[0]> = {}) => {
    const opened: string[] = [];
    render(
      <ul>
        <SessionCard
          title="Migrar o banco"
          project="central"
          host="alfa"
          stateLabel="precisa de você"
          tone="needs-you"
          line="Pedido: migre · esperando Write"
          cost="US$ 1,25"
          costLabel="Custo de Migrar o banco"
          persona="Revisora"
          onOpen={() => opened.push("open")}
          {...patch}
        />
      </ul>,
    );
    return opened;
  };
  const li = () => screen.getByRole("listitem", { name: "Migrar o banco" });

  test("it shows title, project, host, status, the last line, the pending request and the cost", () => {
    card();
    const text = li().textContent ?? "";
    for (const part of ["Migrar o banco", "central", "alfa", "Pedido: migre · esperando Write"]) {
      expect(text).toContain(part);
    }
    expect(within(li()).queryByRole("img", { name: "precisa de você" })).not.toBeNull();
    expect(
      within(li()).queryByRole("status", { name: "Custo de Migrar o banco" })?.textContent,
    ).toBe("US$ 1,25");
    expect(text).toContain("Revisora");
  });

  test("no cost, no persona and no line leave those parts out", () => {
    card({ cost: undefined, persona: null, line: "" });
    expect(within(li()).queryByRole("status")).toBeNull();
    expect(li().querySelector("[data-slot='card-line']")).toBeNull();
    expect(li().textContent).not.toContain("Revisora");
  });

  test("the title opens the session; the open one and the keyboard's one are marked", async () => {
    const opened = card({ current: true, active: true });
    await act(async () => {
      fireEvent.click(within(li()).getByRole("button", { name: "Migrar o banco" }));
    });
    expect(opened).toEqual(["open"]);
    expect(li().getAttribute("aria-current")).toBe("true");
    expect(li().getAttribute("data-active")).toBe("true");
  });

  test("the actions menu is drawn inside the card", () => {
    card({ actions: <button type="button">Ações</button> });
    expect(within(li()).queryByRole("button", { name: "Ações" })).not.toBeNull();
  });
});

describe("hub-cartoes: the hub as a grid", () => {
  /** A daemon with one idle managed session. */
  async function withSession() {
    const d = makeDaemon(cleanups);
    const repo = join(d.root, "gerenciada");
    mkdirSync(repo);
    git(repo, "init", "-q", "-b", "main");
    git(repo, "remote", "add", "origin", "https://github.com/acme/central.git");
    const { sessionId } = await d.manager.create({ cwd: repo, prompt: "oi", name: "Gerenciada" });
    await poll(() => d.manager.get(sessionId).status === "idle");
    return d;
  }
  /** A window on the hub; the host is added only the first time, a later window finds it saved. */
  async function hub(
    platform = memoryPlatform(),
    daemon?: Awaited<ReturnType<typeof withSession>>,
  ) {
    const d = daemon ?? (await withSession());
    const store = new AppStore(platform.platform, { baseDelayMs: 60_000 });
    render(<App store={store} />);
    if (!daemon) {
      await act(async () => {
        await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
      });
    }
    await settle(() => store.getState().hosts[0]?.status === "online");
    await act(async () => store.router.push({ name: "hub" }));
    await settle(() => !!screen.queryByRole("listitem", { name: "Gerenciada" }));
    return { platform, store, d };
  }
  const toggle = (name: string) => screen.queryByRole("button", { name });

  test("a toggle swaps the lines for cards and back, and says which one is on", async () => {
    await hub();
    expect(toggle("Lista")?.getAttribute("aria-pressed")).toBe("true");
    expect(toggle("Cartões")?.getAttribute("aria-pressed")).toBe("false");
    expect(document.querySelector("[data-slot='session-card']")).toBeNull();
    await act(async () => {
      fireEvent.click(toggle("Cartões") as HTMLElement);
    });
    const card = screen.getByRole("listitem", { name: "Gerenciada" });
    expect(card.getAttribute("data-slot")).toBe("session-card");
    expect(card.textContent).toContain("alfa");
    expect(card.textContent).toContain("central");
    expect(toggle("Cartões")?.getAttribute("aria-pressed")).toBe("true");
    await act(async () => {
      fireEvent.click(toggle("Lista") as HTMLElement);
    });
    expect(document.querySelector("[data-slot='session-card']")).toBeNull();
  });

  test("the choice is kept: a new window opens on the cards", async () => {
    const platform = memoryPlatform();
    const { d } = await hub(platform);
    await act(async () => {
      fireEvent.click(toggle("Cartões") as HTMLElement);
    });
    expect(platform.items.get(HUB_VIEW_KEY)).toBe("cards");
    cleanup();
    await hub(platform, d);
    expect(document.querySelector("[data-slot='session-card']")).not.toBeNull();
    expect(toggle("Cartões")?.getAttribute("aria-pressed")).toBe("true");
  });

  test("opening a card opens the session, and its menu has the row's actions", async () => {
    const { store } = await hub();
    await act(async () => {
      fireEvent.click(toggle("Cartões") as HTMLElement);
    });
    const card = screen.getByRole("listitem", { name: "Gerenciada" });
    expect(within(card).queryByRole("button", { name: "Ações de Gerenciada" })).not.toBeNull();
    await act(async () => {
      fireEvent.click(within(card).getByRole("button", { name: "Gerenciada" }));
    });
    await settle(() => store.router.current.name === "session");
  });
});
