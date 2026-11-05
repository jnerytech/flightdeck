import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { ptBR as t } from "../src/i18n/pt-BR.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
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

/** A project's board open, with the New card dialog filled in. */
async function filledDialog() {
  const d = makeDaemon(cleanups);
  const repo = join(d.root, "shop");
  mkdirSync(repo, { recursive: true });
  await Bun.spawn(["git", "init", "-q", repo]).exited;
  const store = new AppStore(memoryPlatform(false, "pt-BR").platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
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
  await act(async () => {
    fireEvent.click(screen.queryByRole("button", { name: t.kanban.newCard }) as HTMLElement);
  });
  await act(async () => {
    fireEvent.change(screen.queryByLabelText(t.kanban.titleLabel) as HTMLElement, {
      target: { value: "Ship the cart" },
    });
    fireEvent.change(screen.queryByLabelText(t.kanban.descriptionLabel) as HTMLElement, {
      target: { value: "Sum the items." },
    });
  });
  expect(screen.queryByRole("dialog", { name: t.kanban.newCard })).not.toBeNull();
  return { d, store, projectId: project?.id ?? "" };
}

const submit = () =>
  act(async () => {
    fireEvent.click(screen.queryByRole("button", { name: t.kanban.create }) as HTMLElement);
  });
const field = (label: string) => screen.queryByLabelText(label) as HTMLInputElement | null;

describe("create-card: the New card dialog keeps what was typed until the card exists", () => {
  // Issue #229 (OpenCode R11): the dialog closed and forgot the text before the host answered, so
  // a refused create lost the title and the description.
  test("a create the host refuses keeps the dialog open with the title and the description", async () => {
    const { store } = await filledDialog();
    const real = store.hostCommand.bind(store);
    store.hostCommand = (async (hostId, type, payload) =>
      type === "card.create" ? null : real(hostId, type, payload)) as typeof store.hostCommand;
    await submit();
    await act(async () => {});
    expect(screen.queryByRole("dialog", { name: t.kanban.newCard })).not.toBeNull();
    expect(field(t.kanban.titleLabel)?.value).toBe("Ship the cart");
    expect(field(t.kanban.descriptionLabel)?.value).toBe("Sum the items.");
  });

  test("a create that went through closes the dialog, and the next one starts empty", async () => {
    await filledDialog();
    await submit();
    await settle(() => screen.queryByRole("dialog", { name: t.kanban.newCard }) === null);
    await settle(() => screen.queryByLabelText("Card Ship the cart") !== null);
    await act(async () => {
      fireEvent.click(screen.queryByRole("button", { name: t.kanban.newCard }) as HTMLElement);
    });
    expect(field(t.kanban.titleLabel)?.value).toBe("");
  });
});
