import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { en } from "../src/i18n/en.ts";
import { registerDom } from "./dom.ts";
import { fakeAssistant, daemon as makeDaemon, memoryPlatform, TOKEN, waitFor } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { AppStore, sessionKey } = await import("../src/lib/app-store.ts");
const { hubRows } = await import("../src/lib/hub.ts");
const { useStoreState } = await import("../src/lib/use-store.ts");
const { SessionTiles } = await import("../src/components/projects/session-tiles.tsx");
const { TContext } = await import("../src/i18n/context.tsx");

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
  text: "Fix the failing login test and explain the cause.",
};

function Live(props: { store: InstanceType<typeof AppStore>; hostId: string; projectKey: string }) {
  const state = useStoreState(props.store);
  return (
    <TContext.Provider value={props.store.i18n.t}>
      <SessionTiles
        store={props.store}
        state={state}
        hostId={props.hostId}
        projectKey={props.projectKey}
        onOpen={() => {}}
      />
    </TContext.Provider>
  );
}

/** One session tile, with an assistant that answers `ANSWER`. */
async function tile(options: { configured?: boolean } = {}) {
  const d = makeDaemon(cleanups);
  const server = d.listen();
  const mem = memoryPlatform(false, "en");
  const fake = fakeAssistant({ run: () => ANSWER });
  if (options.configured !== false) await fake.assistant.setKey("anthropic", "sk-ant-aaaabbbb");
  mem.platform.assistant = fake.assistant;
  const store = new AppStore(mem.platform, { baseDelayMs: 10, maxDelayMs: 20 });
  cleanups.push(() => store.dispose());
  store.i18n.start();
  if (options.configured !== false) {
    store.assistant.setPrefs({ provider: "anthropic" });
    await store.assistant.refreshKeys();
  }
  const hostId = await store.addHost({ name: "pc", url: server.url, token: TOKEN });
  await waitFor(() => store.getState().hosts.find((h) => h.id === hostId)?.status === "online");
  const id = (await store.createSession(hostId, {
    cwd: d.project,
    prompt: "oi",
    name: "um",
  })) as string;
  await waitFor(() => store.getState().sessions[sessionKey(hostId, id)]?.status !== undefined);
  store.select(hostId, null);
  await store.refreshHub();
  const projectKey = hubRows(store.getState())[0]?.projectKey as string;
  render(<Live store={store} hostId={hostId} projectKey={projectKey} />);
  await waitFor(() => screen.queryByLabelText(en.tiles.message.replace("{name}", "um")) !== null);
  return { store, fake };
}

const box = () =>
  screen.queryByLabelText(en.tiles.message.replace("{name}", "um")) as HTMLTextAreaElement | null;
const wands = () => screen.queryAllByRole("button", { name: /with AI/ });
const asked = (fake: ReturnType<typeof fakeAssistant>) => fake.calls.filter((c) => c[0] === "run");

describe("assistant-fields-tiles: the message box of a session tile (issue #160)", () => {
  test("the message improves with the wand and is not sent by it", async () => {
    const { store, fake } = await tile();
    const sent: string[] = [];
    store.sendTo = (async (_host: string, _id: string, text: string) => {
      sent.push(text);
    }) as typeof store.sendTo;
    await act(async () => {
      fireEvent.change(box() as HTMLElement, { target: { value: "login test broken" } });
    });
    expect(wands()).toHaveLength(1);
    await act(async () => {
      fireEvent.click(wands()[0] as HTMLElement);
    });
    await waitFor(() => screen.queryByRole("dialog", { name: "AI suggestion" }) !== null);
    expect(JSON.stringify(asked(fake).at(-1)?.[1])).toContain("login test broken");
    await act(async () => {
      fireEvent.click(screen.queryByRole("button", { name: "Accept" }) as HTMLElement);
    });
    expect(box()?.value).toBe(ANSWER.text);
    expect(sent).toEqual([]);
  });

  test("with no provider the wand opens Settings, Assistant", async () => {
    const { store, fake } = await tile({ configured: false });
    await act(async () => {
      fireEvent.change(box() as HTMLElement, { target: { value: "login test broken" } });
    });
    expect(wands()[0]).toBeDefined();
    await act(async () => {
      fireEvent.click(wands()[0] as HTMLElement);
    });
    expect(store.router.current).toEqual({ name: "settings", section: "assistant" });
    expect(asked(fake)).toHaveLength(0);
  });
});
