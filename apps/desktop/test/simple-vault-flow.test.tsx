import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, waitFor as pollFor, TOKEN } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(60_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const WAIT = { timeout: 20_000 };
const click = async (name: string | RegExp) => {
  const button = await waitFor(() => screen.getByRole("button", { name }), WAIT);
  await act(async () => {
    fireEvent.click(button);
  });
};

describe("simple-vault-flow: a task that needs full access, end to end (issue #88)", () => {
  test("Given a task that asks for the vault, Then the card has no yes or no, and Copy a message puts the sentence on the clipboard", async () => {
    const copied: string[] = [];
    const mem = memoryPlatform(false, "en");
    mem.platform.copyText = async (text) => void copied.push(text);
    let picked = "";
    mem.platform.pickFolder = async () => picked;
    const d = makeDaemon(cleanups, { simple: true, ui: { mode: "simple", locked: false } });
    const server = d.listen();
    const store = new AppStore(mem.platform, { baseDelayMs: 10, maxDelayMs: 20 });
    cleanups.push(() => store.dispose());
    render(<App store={store} />);
    const hostId = await act(() => store.addHost({ name: "pc", url: server.url, token: TOKEN }));
    await pollFor(() => store.getState().hosts.find((h) => h.id === hostId)?.hostInfo, "host info");
    const folder = join(d.root, "notes");
    mkdirSync(folder, { recursive: true });
    picked = folder;
    await click(/Summarise a folder/);
    await click("Choose folder…");
    await waitFor(() => expect(screen.getAllByRole("textbox").length).toBeGreaterThan(0), WAIT);
    await click("Start this task");
    await waitFor(() => screen.getByText("Done", { selector: "[data-slot='task-chip']" }), WAIT);
    // The task asks for something only someone with full access can give.
    fireEvent.change(
      await waitFor(() => screen.getByRole("textbox", { name: "Ask for changes" }), WAIT),
      { target: { value: "[vault] fetch the deploy key" } },
    );
    await click("Send");
    await waitFor(
      () => expect(screen.queryByText("This needs someone with full access")).not.toBeNull(),
      { timeout: 5000 },
    );
    expect(screen.queryByRole("button", { name: "Yes, go ahead" })).toBeNull();
    await click("Copy a message for the administrator");
    expect(copied).toHaveLength(1);
    expect(copied[0]).toContain("A task is waiting for someone with full access:");
  });
});
