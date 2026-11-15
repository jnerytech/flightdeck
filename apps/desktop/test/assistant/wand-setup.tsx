import { expect } from "bun:test";
import { translator } from "../../src/i18n/index.ts";
import { liveScreen, registerDom } from "../dom.ts";
import { fakeAssistant, memoryPlatform } from "../fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");

export { act, fireEvent, render, within };
export const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { SessionView } = await import("../../src/features/sessions/session-view.tsx");
const { emptySession } = await import("../../src/features/sessions/domain/session-state.ts");

const realObserver = globalThis.ResizeObserver;
const realSetTimeout = globalThis.setTimeout;
export function restoreGlobals() {
  cleanup();
  globalThis.ResizeObserver = realObserver;
  globalThis.setTimeout = realSetTimeout;
}

/** Reports a 664x480 box to every observer, as a real layout does in a 720x480 window. */
function shortWindow() {
  globalThis.ResizeObserver = class {
    constructor(private readonly callback: (entries: unknown[]) => void) {}
    observe() {
      this.callback([{ contentRect: { width: 664, height: 480 } }]);
    }
    disconnect() {}
    unobserve() {}
  } as unknown as typeof ResizeObserver;
}

export const ANSWER = {
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

export async function make(
  script: Parameters<typeof fakeAssistant>[0] = {},
  options: {
    language?: "en" | "pt-BR";
    configured?: boolean;
    assist?: boolean;
    short?: boolean;
    /** The host of the field and the folder it works in. */
    field?: { hostId: string; cwd: string };
  } = {},
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
  if (options.short) shortWindow();
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
              ...(options.field
                ? { fieldHostId: options.field.hostId, cwd: options.field.cwd }
                : {}),
              openSettings: () => void opened.push("settings"),
            },
          })}
    />,
  );
  return { store, fake, opened, t, ui };
}

export const box = () =>
  screen.getByRole("textbox", { name: /^(Message|Mensagem)$/ }) as HTMLTextAreaElement;
export const type = (text: string) => fireEvent.change(box(), { target: { value: text } });
export const click = (name: string | RegExp) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  return act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};
export const asked = (fake: ReturnType<typeof fakeAssistant>) =>
  fake.calls.filter((c) => c[0] === "run");
