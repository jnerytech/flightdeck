import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { en } from "../src/i18n/en.ts";
import { ptBR } from "../src/i18n/pt-BR.ts";
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
};

/** The persona editor, open on a new persona, with an assistant that answers by the kind it is asked. */
async function editor(options: { language?: "en" | "pt-BR"; configured?: boolean } = {}) {
  const language = options.language ?? "en";
  const t = language === "en" ? en : ptBR;
  const mem = memoryPlatform(false, language);
  const fake = fakeAssistant({
    run: (request) => ({
      ...ANSWER,
      text: JSON.stringify(request).includes("one-line description of an agent persona")
        ? "Reviews code before a merge."
        : "You are a careful reviewer.\n\n## Rules\n- Read the diff first.",
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
  await personasHost(cleanups, store);
  render(<App store={store} />);
  await settle(() => screen.queryByRole("button", { name: t.personas.title }) !== null);
  await act(async () => {
    fireEvent.click(screen.queryByRole("button", { name: t.personas.title }) as HTMLElement);
  });
  await settle(() => screen.queryByRole("button", { name: t.personas.newPersona }) !== null);
  await act(async () => {
    fireEvent.click(screen.queryByRole("button", { name: t.personas.newPersona }) as HTMLElement);
  });
  await uiIdle();
  return { store, fake, t };
}

const field = (label: string) => screen.queryByLabelText(label) as HTMLInputElement | null;
const type = (label: string, value: string) =>
  act(async () => {
    fireEvent.change(field(label) as HTMLElement, { target: { value } });
  });
const wands = () => screen.queryAllByRole("button", { name: /with AI/ });
const asked = (fake: ReturnType<typeof fakeAssistant>) => fake.calls.filter((c) => c[0] === "run");

describe("assistant-fields-personas: the persona editor (issue #160)", () => {
  test("the description is written from the name, and the persona is not saved by it", async () => {
    const { store, fake, t } = await editor();
    const sent: string[] = [];
    const real = store.hostRequest.bind(store);
    store.hostRequest = (async (hostId, type, payload) => {
      sent.push(type);
      return real(hostId, type, payload);
    }) as typeof store.hostRequest;
    await type(t.personas.editor.name, "Reviewer");
    expect(wands()).toHaveLength(2);
    await act(async () => {
      fireEvent.click(wands()[0] as HTMLElement);
    });
    await settle(() => screen.queryByRole("dialog", { name: "AI suggestion" }) !== null);
    const request = JSON.stringify(asked(fake).at(-1)?.[1]);
    expect(request).toContain('<context name=\\"name\\">\\nReviewer');
    await act(async () => {
      fireEvent.click(screen.queryByRole("button", { name: "Accept" }) as HTMLElement);
    });
    expect(field(t.personas.editor.description)?.value).toBe("Reviews code before a merge.");
    expect(sent).not.toContain("personas.save");
  });

  test("the instructions are written from the name and the description", async () => {
    const { fake, t } = await editor();
    await type(t.personas.editor.name, "Reviewer");
    await type(t.personas.editor.description, "Reviews code before a merge.");
    expect(wands()[1]).toBeDefined();
    await act(async () => {
      fireEvent.click(wands()[1] as HTMLElement);
    });
    await settle(() => screen.queryByRole("dialog", { name: "AI suggestion" }) !== null);
    const request = JSON.stringify(asked(fake).at(-1)?.[1]);
    expect(request).toContain("instructions of an agent persona");
    expect(request).toContain('<context name=\\"description\\">\\nReviews code before a merge.');
    expect(request).toContain('<context name=\\"name\\">\\nReviewer');
    await act(async () => {
      fireEvent.click(screen.queryByRole("button", { name: "Accept" }) as HTMLElement);
    });
    expect(field(t.personas.editor.body)?.value).toContain("You are a careful reviewer.");
    expect(
      screen.queryByRole("region", { name: t.personas.editor.preview })?.textContent,
    ).toContain("You are a careful reviewer.");
  });

  test("with no provider a wand opens Settings, Assistant", async () => {
    const { store, fake } = await editor({ configured: false });
    expect(wands()[0]).toBeDefined();
    await act(async () => {
      fireEvent.click(wands()[0] as HTMLElement);
    });
    expect(store.router.current).toEqual({ name: "settings", section: "assistant" });
    expect(asked(fake)).toHaveLength(0);
  });

  test("it reads in Portuguese", async () => {
    await editor({ language: "pt-BR" });
    expect(screen.queryAllByRole("button", { name: "Escrever com IA" })).toHaveLength(2);
  });
});
