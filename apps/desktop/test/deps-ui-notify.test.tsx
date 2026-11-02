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

/** One host with a project and the cards A and B, B blocked by A. */
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
  return { store, hostId, a, b, phone };
}

describe("deps-ui: the desktop is told when a card is unblocked", () => {
  test("a notification names the card that has no blocker left", async () => {
    const { store, hostId, a, phone } = await setup();
    await store.hostCommand(hostId, "card.move", { cardId: a.id, column: "done" });
    await settle(() => phone.notifications.some((n) => n.body.includes("B")));
    expect(phone.notifications.some((n) => n.title === "Card desbloqueado")).toBe(true);
  });

  test("a later update of an unblocked card does not announce it again", async () => {
    const { store, hostId, a, b, phone } = await setup();
    await store.hostCommand(hostId, "card.move", { cardId: a.id, column: "done" });
    await settle(() => phone.notifications.length === 1);
    const seen = phone.notifications.length;
    await store.hostCommand(hostId, "card.update", { cardId: b.id, title: "B2" });
    await act(() => Bun.sleep(200));
    expect(phone.notifications).toHaveLength(seen);
  });
});
