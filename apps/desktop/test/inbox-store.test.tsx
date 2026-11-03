import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git } from "../../daemon/test/board-helpers.ts";
import { registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { settle } from "./wait.ts";

registerDom();
const { act, cleanup, render } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** One host, a project and the cards A and B (B blocked by A): moving A to done notifies. */
async function setup() {
  const d = makeDaemon(cleanups);
  const repo = join(d.root, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "commit.gpgsign", "false");
  writeFileSync(join(repo, "README.md"), "# repo\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "inicial");
  const server = d.listen();
  const phone = memoryPlatform();
  const store = new AppStore(phone.platform, { baseDelayMs: 60_000 });
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: server.url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  const hostId = store.getState().hosts[0]?.id as string;
  const project = await store.hostCommand(hostId, "project.add", { path: repo });
  const make = async (title: string, extra: Record<string, unknown> = {}) =>
    (await store.hostCommand(hostId, "card.create", {
      projectId: project?.id as string,
      title,
      description: "",
      ...extra,
    })) as { id: string };
  const a = await make("A");
  const b = await make("B", { blockedBy: [a.id] });
  await store.hostCommand(hostId, "board.watch", {});
  await store.hostCommand(hostId, "card.move", { cardId: a.id, column: "done" });
  await settle(() => store.getState().inbox.length > 0);
  return { store, phone, hostId, projectId: project?.id as string, b };
}

describe("inbox-store", () => {
  test("a notification the app sends is also kept, unread, and still reaches the OS", async () => {
    const { store, phone } = await setup();
    const [entry] = store.getState().inbox;
    expect(entry).toMatchObject({ title: "Card desbloqueado", read: false });
    expect(entry?.body).toContain("B");
    expect(phone.notifications.some((n) => n.title === "Card desbloqueado")).toBe(true);
    expect(phone.items.get("flightdeck.inbox")).toContain("Card desbloqueado");
  });

  test("an unblocked card's entry opens that card", async () => {
    const { store, hostId, projectId, b } = await setup();
    expect(store.getState().inbox[0]?.route).toEqual({
      name: "card",
      host: hostId,
      projectId,
      cardId: b.id,
    });
  });

  test("mark one, mark all and clear change the list and what is saved", async () => {
    const { store, phone } = await setup();
    const id = store.getState().inbox[0]?.id as string;
    store.inboxMarkRead(id);
    expect(store.getState().inbox[0]?.read).toBe(true);
    store.inboxMarkAllRead();
    expect(store.getState().inbox.every((e) => e.read)).toBe(true);
    store.inboxClear();
    expect(store.getState().inbox).toEqual([]);
    expect(phone.items.get("flightdeck.inbox")).toBe("[]");
  });

  test("a new app start loads the saved list", async () => {
    const { phone } = await setup();
    const again = new AppStore(phone.platform, { baseDelayMs: 60_000 });
    cleanups.push(() => again.dispose());
    await again.init();
    expect(again.getState().inbox[0]?.title).toBe("Card desbloqueado");
  });
});
