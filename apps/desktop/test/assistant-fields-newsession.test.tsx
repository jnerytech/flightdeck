import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { fakeAssistant, memoryPlatform } from "./fixtures.ts";
import { personasHost } from "./personas-ui-setup.ts";
import { settle, uiIdle } from "./wait.ts";

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

const ANSWER = {
  model: "claude-haiku-5-5",
  provider: "anthropic" as const,
  usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
  stopReason: "end_turn" as const,
  notices: [] as string[],
  text: "Add a unit test for the login form, then fix what it finds.",
};

/** "+ New session" on a real daemon, with an assistant that answers `ANSWER`. */
async function open(options: { configured?: boolean } = {}) {
  const mem = memoryPlatform(false, "en");
  const fake = fakeAssistant({ run: () => ANSWER });
  if (options.configured !== false) await fake.assistant.setKey("anthropic", "sk-ant-aaaabbbb");
  mem.platform.assistant = fake.assistant;
  const store = new AppStore(mem.platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  if (options.configured !== false) {
    store.assistant.setPrefs({ provider: "anthropic" });
    await store.assistant.refreshKeys();
  }
  const h = await personasHost(cleanups, store);
  render(<App store={store} />);
  await settle(() => store.getState().hosts[0]?.hostInfo?.features?.includes("personas") === true);
  await act(async () => {
    store.router.push({ name: "new-session", host: h.hostId });
  });
  await settle(() => screen.queryByLabelText("First prompt") !== null);
  return { store, fake, ...h };
}

const prompt = () => screen.queryByLabelText("First prompt") as HTMLTextAreaElement | null;
const wands = () => screen.queryAllByRole("button", { name: /with AI/ });
const asked = (fake: ReturnType<typeof fakeAssistant>) => fake.calls.filter((c) => c[0] === "run");

describe("assistant-fields-newsession: the first prompt of a new session (issue #160)", () => {
  test("the prompt improves with the wand and no session starts by it", async () => {
    const { d, fake } = await open();
    await act(async () => {
      fireEvent.change(prompt() as HTMLElement, { target: { value: "login is broken" } });
    });
    await uiIdle();
    expect(wands()).toHaveLength(1);
    await act(async () => {
      fireEvent.click(wands()[0] as HTMLElement);
    });
    await settle(() => screen.queryByRole("dialog", { name: "AI suggestion" }) !== null);
    expect(JSON.stringify(asked(fake).at(-1)?.[1])).toContain("login is broken");
    await act(async () => {
      fireEvent.click(screen.queryByRole("button", { name: "Accept" }) as HTMLElement);
    });
    expect(prompt()?.value).toBe(ANSWER.text);
    expect(d.manager.list()).toHaveLength(0);
  });

  test("with no provider the wand opens Settings, Assistant", async () => {
    const { store, fake } = await open({ configured: false });
    await act(async () => {
      fireEvent.change(prompt() as HTMLElement, { target: { value: "login is broken" } });
    });
    await uiIdle();
    expect(wands()[0]).toBeDefined();
    await act(async () => {
      fireEvent.click(wands()[0] as HTMLElement);
    });
    expect(store.router.current).toEqual({ name: "settings", section: "assistant" });
    expect(asked(fake)).toHaveLength(0);
  });
});
