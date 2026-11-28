import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { BgService } from "../../../daemon/src/bg/service.ts";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";
import { personasHost } from "../personas/ui-setup.ts";
import { settle } from "../wait.ts";
import { chooseFromCardMenu } from "./card-menu.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { App } = await import("../../src/app/App.tsx");

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
    await settle(() => screen.queryByRole("button", { name: /^Ações de / }) !== null);
    const label = screen.queryByRole("button", { name: /^Ações de / })?.getAttribute("aria-label");
    await chooseFromCardMenu(
      { act, fireEvent, screen } as never,
      label ?? "",
      "Iniciar em segundo plano, sem terminal",
    );
    await settle(() => started.length > 0);
    expect(started).toEqual([{ cardId }]);
    // The hub shows it.
    await settle(() => store.router.current.name === "hub");
    expect(store.router.current.name).toBe("hub");
  });

  test("the start from the card says so in a notice naming the card (#4172)", async () => {
    const { store } = await openCard(true);
    const said: string[] = [];
    const success = store.success.bind(store);
    store.success = (text: string) => {
      said.push(text);
      success(text);
    };
    await settle(() => screen.queryByRole("button", { name: /^Ações de / }) !== null);
    const label = screen.queryByRole("button", { name: /^Ações de / })?.getAttribute("aria-label");
    await chooseFromCardMenu(
      { act, fireEvent, screen } as never,
      label ?? "",
      "Iniciar em segundo plano, sem terminal",
    );
    await settle(() => said.length > 0);
    expect(said[0]).toBe(
      'Sessão "Somar o total" iniciada em segundo plano. Ela aparece em Sessões.',
    );
  });

  // #4173: a modal menu marks the rest of the page aria-hidden while its links stay focusable (axe's
  // aria-hidden-focus), as the permission-mode chip's did (#1004): the card's menu keeps the page readable.
  test("the card's menu open leaves the page behind it out of aria-hidden", async () => {
    await openCard(true);
    await settle(() => screen.queryByRole("button", { name: /^Ações de / }) !== null);
    const menu = screen.queryByRole("button", { name: /^Ações de / });
    await act(async () => {
      fireEvent.pointerDown(menu as HTMLElement, {
        button: 0,
        ctrlKey: false,
        pointerType: "mouse",
      });
    });
    await settle(
      () =>
        screen.queryByRole("menuitem", { name: "Iniciar em segundo plano, sem terminal" }) !== null,
    );
    // Radix hides what is not the menu with aria-hidden on the siblings along its path: none may hide a link or button.
    const hidden = Array.from(document.querySelectorAll("[aria-hidden='true']")).filter(
      (el) => el.querySelector("a, button") !== null,
    );
    expect(hidden).toHaveLength(0);
  });

  test("a host without bg has no such button", async () => {
    await openCard(false);
    await settle(() => screen.queryByRole("button", { name: "Iniciar" }) !== null);
    const menu = screen.queryByRole("button", { name: /^Ações de / });
    expect(menu).not.toBeNull();
    await act(async () => {
      fireEvent.pointerDown(menu as HTMLElement, {
        button: 0,
        ctrlKey: false,
        pointerType: "mouse",
      });
    });
    await settle(() => screen.queryByRole("menuitem", { name: "Finalizar…" }) !== null);
    expect(
      screen.queryByRole("menuitem", { name: "Iniciar em segundo plano, sem terminal" }),
    ).toBeNull();
  });
});
