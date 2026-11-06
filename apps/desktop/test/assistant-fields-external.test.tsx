import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { ExternalSession } from "@flightdeck/protocol";
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
  text: "Run the failing test again and show me the first error.",
};

const external = (cwd: string): ExternalSession => ({
  claudeSessionId: "ext-1",
  cwd,
  transcriptPath: null,
  source: null,
  status: "idle",
  statusReason: null,
  launchId: null,
  controllable: true,
  projectKey: null,
  startedAt: "2026-10-30T12:00:00Z",
  lastEventAt: "2026-10-30T12:00:00Z",
  endedAt: null,
});

/** A controllable terminal session on screen, with an assistant that answers `ANSWER`. */
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
  const sent: string[] = [];
  const request = store.hostRequest.bind(store);
  store.hostRequest = (async (hostId: string, type: never, payload: never) => {
    sent.push(type);
    return request(hostId, type, payload);
  }) as typeof store.hostRequest;
  render(<App store={store} />);
  await settle(() => store.getState().hosts[0]?.status === "online");
  await act(async () => {
    (store as unknown as { update(patch: object): void }).update({
      externals: { [`${h.hostId}/ext-1`]: external(h.d.project) },
    });
    store.router.push({ name: "external", host: h.hostId, claudeSessionId: "ext-1" });
  });
  await settle(() => screen.queryByLabelText("Message to the session") !== null);
  await uiIdle();
  return { store, fake, sent };
}

const box = () => screen.queryByLabelText("Message to the session") as HTMLTextAreaElement | null;
const wands = () => screen.queryAllByRole("button", { name: /with AI/ });
const asked = (fake: ReturnType<typeof fakeAssistant>) => fake.calls.filter((c) => c[0] === "run");

describe("assistant-fields-external: the message to a terminal session (issue #160)", () => {
  test("the message improves with the wand and is not sent by it", async () => {
    const { fake, sent } = await open();
    await act(async () => {
      fireEvent.change(box() as HTMLElement, { target: { value: "test fails" } });
    });
    expect(wands()).toHaveLength(1);
    await act(async () => {
      fireEvent.click(wands()[0] as HTMLElement);
    });
    await settle(() => screen.queryByRole("dialog", { name: "AI suggestion" }) !== null);
    expect(JSON.stringify(asked(fake).at(-1)?.[1])).toContain("test fails");
    await act(async () => {
      fireEvent.click(screen.queryByRole("button", { name: "Accept" }) as HTMLElement);
    });
    expect(box()?.value).toBe(ANSWER.text);
    expect(sent).not.toContain("external.message");
  });

  test("with no provider the wand opens Settings, Assistant", async () => {
    const { store, fake } = await open({ configured: false });
    await act(async () => {
      fireEvent.change(box() as HTMLElement, { target: { value: "test fails" } });
    });
    expect(wands()[0]).toBeDefined();
    await act(async () => {
      fireEvent.click(wands()[0] as HTMLElement);
    });
    expect(store.router.current).toEqual({ name: "settings", section: "assistant" });
    expect(asked(fake)).toHaveLength(0);
  });
});
