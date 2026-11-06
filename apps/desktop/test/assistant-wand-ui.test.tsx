import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { translator } from "../src/i18n/index.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { fakeAssistant, memoryPlatform } from "./fixtures.ts";
import { settle, stays } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { SessionView } = await import("../src/ui/SessionView.tsx");
const { emptySession } = await import("../src/lib/session-state.ts");
const { AssistantSettings } = await import("../src/components/assistant/assistant-settings.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const ANSWER = {
  model: "claude-haiku-5-5",
  provider: "anthropic" as const,
  usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
  stopReason: "end_turn" as const,
  notices: [] as string[],
};

const actions = {
  send: async () => {},
  interrupt: async () => {},
  close: async () => {},
  resume: async () => {},
  respond: async () => {},
};

async function make(
  script: Parameters<typeof fakeAssistant>[0] = {},
  options: { language?: "en" | "pt-BR"; configured?: boolean; assist?: boolean } = {},
) {
  const language = options.language ?? "en";
  const mem = memoryPlatform(false, language);
  const fake = fakeAssistant({
    run: () => ({ ...ANSWER, text: "Fix the total." }),
    ...script,
  });
  if (options.configured !== false) await fake.assistant.setKey("anthropic", "sk-ant-aaaabbbb");
  mem.platform.assistant = fake.assistant;
  const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  if (options.configured !== false) {
    store.assistant.setPrefs({ provider: "anthropic" });
    await store.assistant.refreshKeys();
  }
  const opened: string[] = [];
  const t = translator(language);
  const ui = render(
    <SessionView
      t={t}
      title="s"
      session={{ ...emptySession(), status: "idle" }}
      actions={actions}
      {...(options.assist === false
        ? {}
        : {
            assist: {
              controller: store.assistant,
              kind: "prompt" as const,
              openSettings: () => void opened.push("settings"),
            },
          })}
    />,
  );
  return { store, fake, opened, t, ui };
}

const box = () =>
  screen.getByRole("textbox", { name: /^(Message|Mensagem)$/ }) as HTMLTextAreaElement;
const type = (text: string) => fireEvent.change(box(), { target: { value: text } });
const click = (name: string | RegExp) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  return act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};
const asked = (fake: ReturnType<typeof fakeAssistant>) => fake.calls.filter((c) => c[0] === "run");

describe("assistant-wand-ui: the wand on the message box (issue #158)", () => {
  test("a message box with text offers Improve with AI, with its shortcut, beside the other tools", async () => {
    await make();
    type("fix the totl of the cart");
    const wand = screen.queryByRole("button", { name: "Improve with AI" });
    expect(wand?.getAttribute("aria-keyshortcuts")).toBe("Control+I");
    expect(wand?.hasAttribute("disabled")).toBe(false);
  });

  test("an empty box that cannot be written from nothing is disabled, and says why", async () => {
    await make();
    const wand = screen.queryByRole("button", { name: "Write something first" });
    expect(wand?.hasAttribute("disabled")).toBe(true);
  });

  test("a screen that gives no assistant has no wand", async () => {
    await make({}, { assist: false });
    type("some text");
    expect(screen.queryByRole("button", { name: /with AI/ })).toBeNull();
  });

  test("with Show the wand off there is no wand", async () => {
    const { store } = await make();
    type("some text");
    expect(screen.queryByRole("button", { name: "Improve with AI" })).not.toBeNull();
    await act(async () => store.assistant.setPrefs({ enabled: false }));
    expect(screen.queryByRole("button", { name: /with AI/ })).toBeNull();
  });

  test("a click sends the text, shows it running, then Before and After; the box is unchanged until Accept", async () => {
    let answer: (text: string) => void = () => {};
    const { fake } = await make({
      run: (request) =>
        new Promise((resolve) => {
          answer = (text) => resolve({ ...ANSWER, text, model: request.model });
        }),
    });
    type("fix the totl");
    await click("Improve with AI");
    await settle(() => screen.queryByRole("status") !== null);
    expect(screen.getByRole("button", { name: "Cancel" })).not.toBeNull();
    expect(asked(fake)).toHaveLength(1);
    const request = asked(fake)[0]?.[1] as { kind: string; user: string };
    expect(request.kind).toBe("prompt");
    expect(request.user).toContain("fix the totl");
    await act(async () => answer("Fix the total."));
    const dialog = await screen.findByRole("dialog", { name: "AI suggestion" });
    expect(within(dialog).getByText("fix the totl")).not.toBeNull();
    expect(within(dialog).getByText("Fix the total.")).not.toBeNull();
    // Nothing changes before Accept.
    expect(box().value).toBe("fix the totl");
  });

  test("Accept puts the proposal in the box once and closes the preview", async () => {
    const { fake } = await make();
    type("fix the totl");
    await click("Improve with AI");
    const dialog = await screen.findByRole("dialog", { name: "AI suggestion" });
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Accept" }));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Accept" }));
    });
    expect(box().value).toBe("Fix the total.");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(asked(fake)).toHaveLength(1);
  });

  test("Discard and Esc leave the box alone", async () => {
    await make();
    type("fix the totl");
    await click("Improve with AI");
    const dialog = await screen.findByRole("dialog", { name: "AI suggestion" });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Discard" }));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(box().value).toBe("fix the totl");
    await click("Improve with AI");
    const again = await screen.findByRole("dialog", { name: "AI suggestion" });
    await act(async () => {
      fireEvent.keyDown(again, { key: "Escape" });
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(box().value).toBe("fix the totl");
  });

  test("Cancel while it runs stops the request, and a late answer is dropped", async () => {
    let answer: (text: string) => void = () => {};
    const { fake } = await make({
      run: (request) =>
        new Promise((resolve) => {
          answer = (text) => resolve({ ...ANSWER, text, model: request.model });
        }),
    });
    type("fix the totl");
    await click("Improve with AI");
    await click("Cancel");
    expect(fake.calls.filter((c) => c[0] === "cancel")).toHaveLength(1);
    expect(screen.queryByRole("status")).toBeNull();
    await act(async () => answer("Too late."));
    await stays(() => screen.queryByRole("dialog") === null);
    expect(box().value).toBe("fix the totl");
  });

  test("text changed while it ran: the preview says so and Accept asks to go on", async () => {
    let answer: (text: string) => void = () => {};
    await make({
      run: (request) =>
        new Promise((resolve) => {
          answer = (text) => resolve({ ...ANSWER, text, model: request.model });
        }),
    });
    type("fix the totl");
    await click("Improve with AI");
    type("fix the totl of the cart");
    await act(async () => answer("Fix the total."));
    const dialog = await screen.findByRole("dialog", { name: "AI suggestion" });
    expect(within(dialog).getByText("The text changed while this was written.")).not.toBeNull();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Accept anyway" }));
    });
    expect(box().value).toBe("Fix the total.");
  });

  test("Ctrl+I and Cmd+I in the box start the wand and are not typed; IME composition is left alone", async () => {
    const { fake } = await make();
    type("fix the totl");
    const composing = fireEvent.keyDown(box(), { key: "i", ctrlKey: true, isComposing: true });
    expect(composing).toBe(true);
    expect(asked(fake)).toHaveLength(0);
    let notPrevented = true;
    await act(async () => {
      notPrevented = fireEvent.keyDown(box(), { key: "i", ctrlKey: true });
    });
    expect(notPrevented).toBe(false);
    await screen.findByRole("dialog", { name: "AI suggestion" });
    expect(asked(fake)).toHaveLength(1);
    await click("Discard");
    await act(async () => {
      fireEvent.keyDown(box(), { key: "I", metaKey: true });
    });
    await screen.findByRole("dialog", { name: "AI suggestion" });
    expect(asked(fake)).toHaveLength(2);
    // Other keys are the box's.
    expect(fireEvent.keyDown(box(), { key: "i" })).toBe(true);
  });

  test("with no provider the click opens Settings and asks it to say so; nothing is sent", async () => {
    const { store, fake, opened } = await make({}, { configured: false });
    type("fix the totl");
    await click("Improve with AI");
    expect(opened).toEqual(["settings"]);
    expect(store.assistant.wantsSetup()).toBe(true);
    expect(asked(fake)).toHaveLength(0);
  });

  test("a secret in the text is refused on the spot, naming what it looks like and never the text", async () => {
    const { fake } = await make();
    type("use sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789 please");
    await click("Improve with AI");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Nothing was sent");
    expect(alert.textContent).not.toContain("abcdefghijklmnop");
    expect(asked(fake)).toHaveLength(0);
    await click("Dismiss");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("a refusal of the provider is said in words", async () => {
    await make({
      run: () => {
        throw { reason: "assistant_credits" };
      },
    });
    type("fix the totl");
    await click("Improve with AI");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("The provider says there is no credit left on this key.");
  });

  test("while another wand holds the one run, this one is disabled and says why", async () => {
    const { store } = await make();
    type("fix the totl");
    await act(async () => void store.assistant.gate.acquire("other"));
    expect(
      screen
        .getByRole("button", { name: "Another AI request is running" })
        .hasAttribute("disabled"),
    ).toBe(true);
    await act(async () => store.assistant.gate.release("other"));
    expect(screen.getByRole("button", { name: "Improve with AI" }).hasAttribute("disabled")).toBe(
      false,
    );
  });

  test("it reads in Portuguese", async () => {
    await make({}, { language: "pt-BR" });
    type("corrige o totl");
    await click("Melhorar com IA");
    const dialog = await screen.findByRole("dialog", { name: "Sugestão da IA" });
    expect(within(dialog).getByRole("button", { name: "Aceitar" })).not.toBeNull();
    expect(within(dialog).getByRole("button", { name: "Descartar" })).not.toBeNull();
  });
});

describe("assistant-wand-ui: Settings says why it opened (issue #158)", () => {
  test("after a wand found no provider, Settings shows the one-line notice once", async () => {
    const { store, t } = await make({}, { configured: false });
    store.assistant.askForSetup();
    const settings = render(<AssistantSettings store={store} t={t} />);
    expect(screen.queryByRole("note")?.textContent).toBe(
      "Choose an AI provider to use the wand on text fields.",
    );
    expect(store.assistant.wantsSetup()).toBe(false);
    settings.unmount();
    render(<AssistantSettings store={store} t={t} />);
    expect(screen.queryByRole("note")).toBeNull();
  });
});
