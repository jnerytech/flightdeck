import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git } from "../../daemon/test/board-helpers.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";

registerDom();
const {
  act,
  cleanup,
  fireEvent,
  render,
  within,
  waitFor: rtlWaitFor,
} = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const waitFor = <T,>(fn: () => T) => rtlWaitFor(fn, { timeout: 3000 });

async function setup() {
  const d = makeDaemon(cleanups);
  const server = d.listen(0, 20);
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 10 });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  const hostId = await act(() => store.addHost({ name: "pc", url: server.url, token: TOKEN }));
  await waitFor(() => expect(screen.queryByLabelText("pc: online")).not.toBeNull());
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Abrir host pc" }));
  });
  await waitFor(() => expect(screen.queryByRole("heading", { name: "pc" })).not.toBeNull());
  const repo = join(d.root, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "commit.gpgsign", "false");
  writeFileSync(join(repo, "README.md"), "# repo\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "inicial");
  await act(async () => {
    await store.hostCommand(hostId, "project.add", { path: repo });
    await store.loadPalette();
  });
  return { store, hostId };
}

describe("host-abrir-projeto: a project on the host page opens (issue #207)", () => {
  test("clicking a project's card on the host page opens that project's page", async () => {
    const { store, hostId } = await setup();
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /^Abrir (o projeto )?repo/ })).not.toBeNull(),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Abrir (o projeto )?repo/ }));
    });
    expect(store.router.current).toMatchObject({ name: "project", host: hostId });
  });
});
