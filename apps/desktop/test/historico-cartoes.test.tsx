import { afterEach, describe, expect, test } from "bun:test";
import { userLine, writeTranscript } from "../../daemon/test/history-helpers.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { sidebarNav } from "./sidebar.ts";
import { waiter } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const sidebar = sidebarNav({ act, fireEvent, screen });
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");
const { HistoryCard } = await import("../src/components/hub/history-card.tsx");

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const settle = waiter(3000);

describe("historico-cartoes: a history card", () => {
  const card = (patch: Partial<Parameters<typeof HistoryCard>[0]> = {}) => {
    const opened: string[] = [];
    render(
      <ul>
        <HistoryCard
          title="Revisar o build"
          project="central"
          host="alfa"
          when="01/09/2026 07:00"
          origin="terminal"
          cost="US$ 0,40"
          costLabel="Custo de Revisar o build"
          maybeActive="possivelmente em uso"
          automated="automática"
          onOpen={() => opened.push("open")}
          {...patch}
        />
      </ul>,
    );
    return opened;
  };
  const li = () => screen.getByRole("listitem", { name: "Revisar o build" });

  test("it shows title, project, host, date, cost, origin and the possibly-in-use mark", () => {
    card();
    const text = li().textContent ?? "";
    for (const part of [
      "Revisar o build",
      "central",
      "alfa",
      "01/09/2026 07:00",
      "terminal",
      "possivelmente em uso",
      "automática",
    ]) {
      expect(text).toContain(part);
    }
    expect(within(li()).queryByRole("status")?.textContent).toBe("US$ 0,40");
  });

  test("without cost, in-use mark or automated tag those parts are left out", () => {
    card({ cost: undefined, maybeActive: undefined, automated: undefined });
    expect(within(li()).queryByRole("status")).toBeNull();
    expect(li().textContent).not.toContain("possivelmente");
    expect(li().textContent).not.toContain("automática");
  });

  test("the title opens the session and the open one is marked", async () => {
    const opened = card({ current: true });
    const title = within(li()).queryByRole("button", { name: "Revisar o build" });
    expect(title).not.toBeNull();
    await act(async () => {
      fireEvent.click(title as HTMLElement);
    });
    expect(opened).toEqual(["open"]);
    expect(li().getAttribute("aria-current")).toBe("true");
    expect(li().getAttribute("data-slot")).toBe("history-card");
  });
});

describe("historico-cartoes: the history screen", () => {
  async function open() {
    const d = makeDaemon(cleanups);
    writeTranscript(d.historyRoot, "-p", "s-antiga", [
      userLine({
        uuid: "u1",
        text: "Revisar o build",
        cwd: d.project,
        ts: "2026-09-01T10:00:00.000Z",
      }),
    ]);
    await d.history.scan();
    const platform = memoryPlatform();
    const store = new AppStore(platform.platform, {
      baseDelayMs: 60_000,
      timeZone: "America/Sao_Paulo",
    });
    render(<App store={store} />);
    await act(async () => {
      await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
    });
    await settle(() => store.getState().hosts[0]?.status === "online");
    await sidebar.hostAction("Histórico");
    await sidebar.showAutomated();
    await settle(() => !!screen.queryByRole("list", { name: "Sessões do histórico" }));
    return { platform };
  }
  const toggle = (name: string) => screen.queryByRole("button", { name });
  const cards = () => document.querySelectorAll("[data-slot='history-card']");

  test("the same toggle swaps the lines for cards with the host, the folder and the origin", async () => {
    await open();
    expect(toggle("Lista")?.getAttribute("aria-pressed")).toBe("true");
    expect(cards()).toHaveLength(0);
    expect(toggle("Cartões")).not.toBeNull();
    await act(async () => {
      fireEvent.click(toggle("Cartões") as HTMLElement);
    });
    expect(cards()).toHaveLength(1);
    const text = cards()[0]?.textContent ?? "";
    expect(text).toContain("Revisar o build");
    expect(text).toContain("alfa");
    expect(text).toContain("terminal");
    await act(async () => {
      fireEvent.click(toggle("Lista") as HTMLElement);
    });
    expect(cards()).toHaveLength(0);
  });

  test("opening a card opens the transcript", async () => {
    await open();
    expect(toggle("Cartões")).not.toBeNull();
    await act(async () => {
      fireEvent.click(toggle("Cartões") as HTMLElement);
    });
    expect(cards()).toHaveLength(1);
    const title = within(cards()[0] as HTMLElement).queryByRole("button");
    expect(title).not.toBeNull();
    await act(async () => {
      fireEvent.click(title as HTMLElement);
    });
    await settle(() => cards()[0]?.getAttribute("aria-current") === "true");
    expect(cards()[0]?.getAttribute("aria-current")).toBe("true");
  });
});
