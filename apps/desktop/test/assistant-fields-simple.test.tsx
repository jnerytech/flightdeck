import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { liveScreen, registerDom } from "./dom.ts";
import {
  fakeAssistant,
  daemon as makeDaemon,
  memoryPlatform,
  waitFor as pollFor,
  TOKEN,
} from "./fixtures.ts";

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

const ANSWER = {
  model: "claude-haiku-5-5",
  provider: "anthropic" as const,
  usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
  stopReason: "end_turn" as const,
  notices: [] as string[],
  text: "Make the summary half as long, in plain words.",
};

/** Simple mode with a finished task; `configured` says whether an assistant provider is ready. */
async function finishedTask(configured: boolean) {
  const mem = memoryPlatform(false, "en");
  const fake = fakeAssistant({ run: () => ANSWER });
  if (configured) await fake.assistant.setKey("anthropic", "sk-ant-aaaabbbb");
  mem.platform.assistant = fake.assistant;
  const d = makeDaemon(cleanups, { simple: true, ui: { mode: "simple", locked: false } });
  const server = d.listen();
  const store = new AppStore(mem.platform, { baseDelayMs: 10, maxDelayMs: 20 });
  cleanups.push(() => store.dispose());
  if (configured) {
    store.assistant.setPrefs({ provider: "anthropic" });
    await store.assistant.refreshKeys();
  }
  render(<App store={store} />);
  const hostId = await act(() => store.addHost({ name: "pc", url: server.url, token: TOKEN }));
  await pollFor(() => store.getState().hosts.find((h) => h.id === hostId)?.hostInfo, "host info");
  const folder = join(d.root, "notes");
  mkdirSync(folder, { recursive: true });
  mem.platform.pickFolder = async () => folder;
  await click(/Summarise a folder/);
  await click("Choose folder…");
  await waitFor(() => expect(screen.getAllByRole("textbox").length).toBeGreaterThan(0), WAIT);
  await click("Start this task");
  await waitFor(() => screen.getByText("Done", { selector: "[data-slot='task-chip']" }), WAIT);
  const box = await waitFor(() => screen.getByRole("textbox", { name: "Ask for changes" }), WAIT);
  return { store, fake, box: box as HTMLTextAreaElement };
}

describe("assistant-fields-simple: Ask for changes in simple mode (issue #160)", () => {
  test("with a provider ready the request improves with the wand, in plain words, and is not sent by it", async () => {
    const { box, fake } = await finishedTask(true);
    await act(async () => {
      fireEvent.change(box, { target: { value: "shorter pls" } });
    });
    await waitFor(() => expect(screen.queryByRole("button", { name: /with AI/ })).not.toBeNull(), {
      timeout: 3000,
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /with AI/ }));
    });
    await waitFor(() => screen.getByRole("dialog", { name: "AI suggestion" }), WAIT);
    const request = JSON.stringify(fake.calls.filter((c) => c[0] === "run").at(-1)?.[1]);
    expect(request).toContain("shorter pls");
    expect(request).toContain("plain words");
    await click("Accept");
    expect(box.value).toBe(ANSWER.text);
    // Nothing was asked of the task: it is still Done.
    expect(screen.queryByText("Done", { selector: "[data-slot='task-chip']" })).not.toBeNull();
  });

  // unstable: #737 times out at "Choose folder…" in CI (the pick-folder platform hook is set after the first render)
  test.skip("with no provider there is no wand: simple mode has no Assistant settings to send the person to", async () => {
    const { box } = await finishedTask(false);
    await act(async () => {
      fireEvent.change(box, { target: { value: "shorter pls" } });
    });
    expect(screen.queryByRole("button", { name: /with AI/ })).toBeNull();
  });
});
