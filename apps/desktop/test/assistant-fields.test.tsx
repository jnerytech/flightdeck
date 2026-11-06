import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { en } from "../src/i18n/en.ts";
import { ptBR } from "../src/i18n/pt-BR.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { fakeAssistant, daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { waiter } from "./wait.ts";

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
const settle = waiter(8000);

const ANSWER = {
  model: "claude-haiku-5-5",
  provider: "anthropic" as const,
  usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
  stopReason: "end_turn" as const,
  notices: [] as string[],
};

/** A project's board, with an assistant that answers by the kind it is asked. */
async function openBoard(options: { language?: "en" | "pt-BR"; configured?: boolean } = {}) {
  const language = options.language ?? "en";
  const t = language === "en" ? en : ptBR;
  const d = makeDaemon(cleanups);
  const repo = join(d.root, "shop");
  mkdirSync(repo, { recursive: true });
  await Bun.spawn(["git", "init", "-q", repo]).exited;
  const mem = memoryPlatform(false, language);
  const fake = fakeAssistant({
    run: (request) => ({
      ...ANSWER,
      text: JSON.stringify(request).includes("title of a work card")
        ? "Ship the cart"
        : "Sum the items; check the totals.",
    }),
  });
  if (options.configured !== false) await fake.assistant.setKey("anthropic", "sk-ant-aaaabbbb");
  mem.platform.assistant = fake.assistant;
  const store = new AppStore(mem.platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  if (options.configured !== false) {
    store.assistant.setPrefs({ provider: "anthropic" });
    await store.assistant.refreshKeys();
  }
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  const hostId = store.getState().hosts[0]?.id ?? "";
  const project = await store.hostCommand(hostId, "project.add", { path: repo });
  await act(async () => {
    store.router.push({ name: "board", host: hostId, projectId: project?.id ?? "" });
  });
  await settle(() => screen.queryByRole("button", { name: t.kanban.newCard }) !== null);
  return { store, fake, t, hostId, projectId: project?.id ?? "" };
}

/** The New card dialog of a project's board. */
async function newCardDialog(options: { language?: "en" | "pt-BR"; configured?: boolean } = {}) {
  const board = await openBoard(options);
  await act(async () => {
    fireEvent.click(screen.queryByRole("button", { name: board.t.kanban.newCard }) as HTMLElement);
  });
  expect(screen.queryByRole("dialog", { name: board.t.kanban.newCard })).not.toBeNull();
  return board;
}

/** The detail of a card with a title and a description, open on its fields. */
async function cardDetail(
  options: { language?: "en" | "pt-BR"; configured?: boolean } = {},
  card = { title: "Ship the cart", description: "Sum the items." },
) {
  const board = await openBoard(options);
  const made = await board.store.hostCommand(board.hostId, "card.create", {
    projectId: board.projectId,
    ...card,
  });
  await act(async () => {
    board.store.router.push({
      name: "card",
      host: board.hostId,
      projectId: board.projectId,
      cardId: made?.id ?? "",
    });
  });
  await settle(() => field(board.t.cardUi.title) !== null);
  return { ...board, cardId: made?.id ?? "" };
}

const field = (label: string) => screen.queryByLabelText(label) as HTMLInputElement | null;
const type = (label: string, value: string) =>
  act(async () => {
    fireEvent.change(field(label) as HTMLElement, { target: { value } });
  });
const click = async (name: string | RegExp) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};
const asked = (fake: ReturnType<typeof fakeAssistant>) => fake.calls.filter((c) => c[0] === "run");

describe("assistant-fields: the New card dialog (issue #160)", () => {
  test("the title is written from the description, and the description is context, not changed", async () => {
    const { fake, t } = await newCardDialog();
    await type(t.kanban.descriptionLabel, "Sum the items.");
    await click("Write with AI");
    const dialog = await screen.findByRole("dialog", { name: "AI suggestion" });
    const request = JSON.stringify(asked(fake).at(-1)?.[1]);
    expect(request).toContain("title of a work card");
    expect(request).toContain('<context name=\\"description\\">\\nSum the items.');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Accept" }));
    });
    expect(field(t.kanban.titleLabel)?.value).toBe("Ship the cart");
    expect(field(t.kanban.descriptionLabel)?.value).toBe("Sum the items.");
  });

  test("the description is written from the title, with the title as context", async () => {
    const { fake, t } = await newCardDialog();
    await type(t.kanban.titleLabel, "Ship the cart");
    await click("Write with AI");
    const dialog = await screen.findByRole("dialog", { name: "AI suggestion" });
    const request = JSON.stringify(asked(fake).at(-1)?.[1]);
    expect(request).toContain("description of a work card");
    expect(request).toContain('<context name=\\"title\\">\\nShip the cart');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Accept" }));
    });
    expect(field(t.kanban.descriptionLabel)?.value).toBe("Sum the items; check the totals.");
    expect(field(t.kanban.titleLabel)?.value).toBe("Ship the cart");
  });

  test("Ctrl+I in a field starts its wand, and Esc in the preview closes the preview, not the dialog", async () => {
    const { fake, t } = await newCardDialog();
    await type(t.kanban.titleLabel, "ship the crat");
    await act(async () => {
      fireEvent.keyDown(field(t.kanban.titleLabel) as HTMLElement, { key: "i", ctrlKey: true });
    });
    expect(asked(fake)).toHaveLength(1);
    await settle(() => screen.queryByRole("dialog", { name: "AI suggestion" }) !== null);
    await act(async () => {
      fireEvent.keyDown(screen.queryByRole("dialog", { name: "AI suggestion" }) as HTMLElement, {
        key: "Escape",
      });
    });
    expect(screen.queryByRole("dialog", { name: "AI suggestion" })).toBeNull();
    expect(screen.queryByRole("dialog", { name: t.kanban.newCard })).not.toBeNull();
    expect(field(t.kanban.titleLabel)?.value).toBe("ship the crat");
  });

  test("no wand button submits the form: the card is not created by using the wand", async () => {
    const { store, t } = await newCardDialog();
    const sent: string[] = [];
    const real = store.hostCommand.bind(store);
    store.hostCommand = (async (hostId, type, payload) => {
      sent.push(type);
      return real(hostId, type, payload);
    }) as typeof store.hostCommand;
    await type(t.kanban.titleLabel, "ship the crat");
    await click("Improve with AI");
    await settle(() => screen.queryByRole("dialog", { name: "AI suggestion" }) !== null);
    await click("Retry");
    await settle(() => screen.queryByRole("button", { name: "Accept" }) !== null);
    await click("Edit");
    await click("Accept");
    await click("Undo");
    expect(screen.queryByRole("dialog", { name: t.kanban.newCard })).not.toBeNull();
    expect(sent).not.toContain("card.create");
    expect(field(t.kanban.titleLabel)?.value).toBe("ship the crat");
  });

  test("with no provider the wand opens Settings, Assistant", async () => {
    const { store, fake } = await newCardDialog({ configured: false });
    const wand = screen.queryAllByRole("button", { name: /with AI/ })[0];
    expect(wand).toBeDefined();
    await act(async () => {
      fireEvent.click(wand as HTMLElement);
    });
    expect(store.router.current).toEqual({ name: "settings", section: "assistant" });
    expect(asked(fake)).toHaveLength(0);
  });

  test("it reads in Portuguese", async () => {
    const { t } = await newCardDialog({ language: "pt-BR" });
    await type(t.kanban.descriptionLabel, "Somar os itens.");
    expect(screen.queryByRole("button", { name: "Escrever com IA" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Melhorar com IA" })).not.toBeNull();
  });
});

describe("assistant-fields: the detail of a card (issue #160)", () => {
  test("the title is improved with the description as context; Accept fills the field and saves nothing", async () => {
    const { store, fake, t } = await cardDetail(
      {},
      { title: "Cart", description: "Sum the items." },
    );
    const sent: string[] = [];
    const real = store.hostCommand.bind(store);
    store.hostCommand = (async (hostId, type, payload) => {
      sent.push(type);
      return real(hostId, type, payload);
    }) as typeof store.hostCommand;
    await type(t.cardUi.title, "ship the crat");
    const wands = screen.queryAllByRole("button", { name: /with AI/ });
    // The title, the description and the adjustment box (issue #160).
    expect(wands).toHaveLength(3);
    await act(async () => {
      fireEvent.click(wands[0] as HTMLElement);
    });
    await settle(() => screen.queryByRole("dialog", { name: "AI suggestion" }) !== null);
    const request = JSON.stringify(asked(fake).at(-1)?.[1]);
    expect(request).toContain("title of a work card");
    expect(request).toContain('<context name=\\"description\\">\\nSum the items.');
    await click("Accept");
    expect(field(t.cardUi.title)?.value).toBe("Ship the cart");
    expect(sent).not.toContain("card.update");
    expect(
      screen.queryByRole("button", { name: t.cardUi.saveTitle })?.hasAttribute("disabled"),
    ).toBe(false);
  });

  test("the description is improved with the title as context, and Save keeps it", async () => {
    const { store, fake, t } = await cardDetail();
    const updates: unknown[] = [];
    const real = store.hostCommand.bind(store);
    store.hostCommand = (async (hostId, type, payload) => {
      if (type === "card.update") updates.push(payload);
      return real(hostId, type, payload);
    }) as typeof store.hostCommand;
    await type(t.cardUi.description, "sum the itmes");
    const wands = screen.queryAllByRole("button", { name: /with AI/ });
    expect(wands[1]).toBeDefined();
    await act(async () => {
      fireEvent.click(wands[1] as HTMLElement);
    });
    await settle(() => screen.queryByRole("dialog", { name: "AI suggestion" }) !== null);
    const request = JSON.stringify(asked(fake).at(-1)?.[1]);
    expect(request).toContain("description of a work card");
    expect(request).toContain('<context name=\\"title\\">\\nShip the cart');
    await click("Accept");
    expect(field(t.cardUi.description)?.value).toBe("Sum the items; check the totals.");
    await click(t.cardUi.saveDescription);
    expect(updates).toEqual([
      expect.objectContaining({ description: "Sum the items; check the totals." }),
    ]);
  });

  test("using the wand in the detail does not leave the screen, and with no provider it opens Settings", async () => {
    const { store, fake, t } = await cardDetail({ configured: false });
    await type(t.cardUi.title, "ship the crat");
    const wand = screen.queryAllByRole("button", { name: /with AI/ })[0];
    expect(wand).toBeDefined();
    await act(async () => {
      fireEvent.click(wand as HTMLElement);
    });
    expect(store.router.current).toEqual({ name: "settings", section: "assistant" });
    expect(asked(fake)).toHaveLength(0);
  });

  test("it reads in Portuguese", async () => {
    const { t } = await cardDetail({ language: "pt-BR" });
    await type(t.cardUi.title, "enviar o carrinho");
    expect(screen.queryAllByRole("button", { name: "Melhorar com IA" }).length).toBe(2);
  });
});

describe("assistant-fields: the adjustment of a card (issue #160)", () => {
  test("the adjustment improves with the wand, and only its own button sends it", async () => {
    const { store, fake, t, cardId } = await cardDetail();
    const sent: Array<{ type: string; payload: unknown }> = [];
    const real = store.hostCommand.bind(store);
    store.hostCommand = (async (hostId, type, payload) => {
      sent.push({ type, payload });
      return real(hostId, type, payload);
    }) as typeof store.hostCommand;
    await type(t.cardUi.adjustment, "make it faster");
    const wands = screen.queryAllByRole("button", { name: /with AI/ });
    expect(wands).toHaveLength(3);
    await act(async () => {
      fireEvent.click(wands[2] as HTMLElement);
    });
    await settle(() => screen.queryByRole("dialog", { name: "AI suggestion" }) !== null);
    expect(JSON.stringify(asked(fake).at(-1)?.[1])).toContain("make it faster");
    await click("Accept");
    expect(field(t.cardUi.adjustment)?.value).toBe("Sum the items; check the totals.");
    expect(sent.map((s) => s.type)).not.toContain("card.message");
    await click(t.cardUi.askAdjustment);
    expect(sent.find((s) => s.type === "card.message")?.payload).toEqual({
      cardId,
      text: "Sum the items; check the totals.",
    });
  });

  test("with no provider the adjustment's wand opens Settings, Assistant", async () => {
    const { store, fake, t } = await cardDetail({ configured: false });
    await type(t.cardUi.adjustment, "make it faster");
    const wands = screen.queryAllByRole("button", { name: /with AI/ });
    expect(wands[2]).toBeDefined();
    await act(async () => {
      fireEvent.click(wands[2] as HTMLElement);
    });
    expect(store.router.current).toEqual({ name: "settings", section: "assistant" });
    expect(asked(fake)).toHaveLength(0);
  });
});
