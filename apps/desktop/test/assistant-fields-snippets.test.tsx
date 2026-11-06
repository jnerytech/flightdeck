import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { en } from "../src/i18n/en.ts";
import { ptBR } from "../src/i18n/pt-BR.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { fakeAssistant, memoryPlatform } from "./fixtures.ts";
import { snippetsHost } from "./snippets-ui-setup.ts";
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

/** The snippet editor, open on a new snippet, with an assistant that answers `reply`. */
async function editor(
  options: { language?: "en" | "pt-BR"; configured?: boolean; reply?: string } = {},
) {
  const language = options.language ?? "en";
  const t = language === "en" ? en : ptBR;
  const mem = memoryPlatform(false, language);
  const fake = fakeAssistant({
    run: () => ({ ...ANSWER, text: options.reply ?? "Review {{file}} and explain the risks." }),
  });
  if (options.configured !== false) await fake.assistant.setKey("anthropic", "sk-ant-aaaabbbb");
  mem.platform.assistant = fake.assistant;
  const store = new AppStore(mem.platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  if (options.configured !== false) {
    store.assistant.setPrefs({ provider: "anthropic" });
    await store.assistant.refreshKeys();
  }
  await snippetsHost(cleanups, store);
  render(<App store={store} />);
  await settle(() => screen.queryByRole("button", { name: t.snippets.title }) !== null);
  await act(async () => {
    fireEvent.click(screen.queryByRole("button", { name: t.snippets.title }) as HTMLElement);
  });
  await settle(() => screen.queryByRole("button", { name: t.snippets.newSnippet }) !== null);
  await act(async () => {
    fireEvent.click(screen.queryByRole("button", { name: t.snippets.newSnippet }) as HTMLElement);
  });
  await uiIdle();
  return { store, fake, t };
}

const field = (label: string) => screen.queryByLabelText(label) as HTMLInputElement | null;
const change = (label: string, value: string) =>
  act(async () => {
    fireEvent.change(field(label) as HTMLElement, { target: { value } });
  });
const wands = () => screen.queryAllByRole("button", { name: /with AI/ });
const asked = (fake: ReturnType<typeof fakeAssistant>) => fake.calls.filter((c) => c[0] === "run");

describe("assistant-fields-snippets: the text of a prompt snippet (issue #160)", () => {
  test("a prompt snippet's text improves with the wand, keeping its variables", async () => {
    const { fake, t } = await editor();
    await change(t.snippets.editor.type, "prompt");
    await change(t.snippets.editor.text, "look at {{file}}");
    expect(wands()).toHaveLength(1);
    expect(wands()[0]).toBeDefined();
    await act(async () => {
      fireEvent.click(wands()[0] as HTMLElement);
    });
    await settle(() => screen.queryByRole("dialog", { name: "AI suggestion" }) !== null);
    const request = JSON.stringify(asked(fake).at(-1)?.[1]);
    expect(request).toContain("reusable prompt");
    expect(request).toContain('<context name=\\"variables\\">\\nfile');
    await act(async () => {
      fireEvent.click(screen.queryByRole("button", { name: "Accept" }) as HTMLElement);
    });
    expect(field(t.snippets.editor.text)?.value).toBe("Review {{file}} and explain the risks.");
  });

  test("a suggestion that changes the variables is not offered, and the text stays", async () => {
    const { t } = await editor({ reply: "Review {{path}} and explain the risks." });
    await change(t.snippets.editor.type, "prompt");
    await change(t.snippets.editor.text, "look at {{file}}");
    expect(wands()[0]).toBeDefined();
    await act(async () => {
      fireEvent.click(wands()[0] as HTMLElement);
    });
    await settle(() => screen.queryByRole("alert") !== null);
    expect(screen.queryByRole("alert")?.textContent).toContain(
      en.assistantRefusal.assistant_placeholders_changed,
    );
    expect(screen.queryByRole("dialog", { name: "AI suggestion" })).toBeNull();
    expect(field(t.snippets.editor.text)?.value).toBe("look at {{file}}");
  });

  test("a command snippet has no wand", async () => {
    const { fake, t } = await editor();
    await change(t.snippets.editor.run, "bun test");
    expect(wands()).toHaveLength(0);
    expect(asked(fake)).toHaveLength(0);
  });

  test("with no provider the wand opens Settings, Assistant", async () => {
    const { store, fake, t } = await editor({ configured: false });
    await change(t.snippets.editor.type, "prompt");
    await change(t.snippets.editor.text, "look at {{file}}");
    expect(wands()[0]).toBeDefined();
    await act(async () => {
      fireEvent.click(wands()[0] as HTMLElement);
    });
    expect(store.router.current).toEqual({ name: "settings", section: "assistant" });
    expect(asked(fake)).toHaveLength(0);
  });

  test("it reads in Portuguese", async () => {
    const { t } = await editor({ language: "pt-BR" });
    await change(t.snippets.editor.type, "prompt");
    await change(t.snippets.editor.text, "olhe {{file}}");
    expect(screen.queryAllByRole("button", { name: /com IA/ })).toHaveLength(1);
  });
});
