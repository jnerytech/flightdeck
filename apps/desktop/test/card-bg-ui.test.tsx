import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { BgService } from "../../daemon/src/bg/service.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { personasHost } from "./personas-ui-setup.ts";
import { settle } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** A service that only records what the host asks of it. */
function stub() {
  const started: Array<Record<string, unknown>> = [];
  const service = {
    list: async () => ({ supported: true, sessions: [] }),
    start: async (input: Record<string, unknown>) => {
      started.push(input);
      return { id: "bgcard01" };
    },
  } as unknown as BgService;
  return { service, started };
}

async function openCard(withBg: boolean) {
  const store = new AppStore(memoryPlatform(false, "pt-BR").platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const recorder = stub();
  const { d, hostId, projectId } = await personasHost(cleanups, store, {
    ...(withBg ? { bg: recorder.service } : {}),
  });
  render(<App store={store} />);
  const card = d.board.createCard(projectId, {
    title: "Somar o total",
    description: "O total erra.",
  });
  await act(async () => {
    store.router.push({ name: "card", host: hostId, projectId, cardId: card.id });
  });
  await settle(() => screen.queryByRole("button", { name: "Voltar ao board" }) !== null);
  return { store, started: recorder.started, cardId: card.id };
}

describe("bg-ui: Iniciar em segundo plano on a card", () => {
  test("the card has the button on a host with bg, and it starts the card in the background", async () => {
    const { store, started, cardId } = await openCard(true);
    await settle(() => screen.queryByRole("button", { name: "Iniciar em segundo plano" }) !== null);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Iniciar em segundo plano" }));
    });
    await settle(() => started.length > 0);
    expect(started).toEqual([{ cardId }]);
    // The hub shows it.
    await settle(() => store.router.current.name === "hub");
    expect(store.router.current.name).toBe("hub");
  });

  test("a host without bg has no such button", async () => {
    await openCard(false);
    await settle(() => screen.queryByRole("button", { name: "Iniciar" }) !== null);
    expect(screen.queryByRole("button", { name: "Iniciar em segundo plano" })).toBeNull();
  });
});
