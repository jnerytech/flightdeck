import { afterEach, describe, expect, setDefaultTimeout, spyOn, test } from "bun:test";
import { translator } from "../src/i18n/index.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { fakeAssistant, memoryPlatform, seedHosts } from "./fixtures.ts";
import { settle, stays } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { SessionView } = await import("../src/ui/SessionView.tsx");
const { emptySession } = await import("../src/lib/session-state.ts");
const { AssistantSettings } = await import("../src/components/assistant/assistant-settings.tsx");

setDefaultTimeout(30_000);
const realObserver = globalThis.ResizeObserver;
const realSetTimeout = globalThis.setTimeout;
afterEach(() => {
  cleanup();
  globalThis.ResizeObserver = realObserver;
  globalThis.setTimeout = realSetTimeout;
});

/** Holds back the long timers (the Undo window) so a test runs them by hand; short ones run as they are. */
function watchTimers() {
  const held: { run: () => void; delay: number }[] = [];
  globalThis.setTimeout = ((run: () => void, delay?: number, ...rest: unknown[]) => {
    if ((delay ?? 0) < 10_000) return realSetTimeout(run, delay, ...rest);
    held.push({ run, delay: delay as number });
    return held.length as unknown as ReturnType<typeof setTimeout>;
  }) as unknown as typeof setTimeout;
  return {
    delays: () => held.map((timer) => timer.delay),
    fire: () => {
      for (const timer of held.splice(0)) timer.run();
    },
  };
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

/** A field on host `fieldHost` working in /work, an API provider that fails, and a confirmed host "alfa" (h1). */
async function makeScoped(fieldHost: string) {
  const made = await make(
    {
      run: () => {
        throw { reason: "assistant_credits" };
      },
    },
    { field: { hostId: fieldHost, cwd: "/work" } },
  );
  seedHosts(made.store, [{ id: "h1", name: "alfa", features: ["assistant"] }]);
  made.store.assistant.confirmHost("h1");
  return { store: made.store, unmount: made.ui.unmount };
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
/** Improve, then Accept the preview: the box holds the proposal and the Undo chip is up. */
async function accepted() {
  await click("Improve with AI");
  const dialog = await screen.findByRole("dialog", { name: "AI suggestion" });
  await act(async () => {
    fireEvent.click(within(dialog).getByRole("button", { name: "Accept" }));
  });
}
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

  test("Edit makes After a text to change, and Accept puts the edited text in the box", async () => {
    await make();
    type("fix the totl");
    await click("Improve with AI");
    const dialog = await screen.findByRole("dialog", { name: "AI suggestion" });
    expect(within(dialog).queryByRole("textbox", { name: "After" })).toBeNull();
    const edit = within(dialog).queryByRole("button", { name: "Edit" });
    expect(edit).not.toBeNull();
    await act(async () => {
      fireEvent.click(edit as HTMLElement);
    });
    const edited = within(dialog).queryByRole("textbox", { name: "After" }) as HTMLTextAreaElement;
    expect(edited?.value).toBe("Fix the total.");
    await act(async () => {
      fireEvent.change(edited, { target: { value: "Fix the total of the cart." } });
    });
    // Nothing reaches the box before Accept, edited or not.
    expect(box().value).toBe("fix the totl");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Accept" }));
    });
    expect(box().value).toBe("Fix the total of the cart.");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("Esc in the edited text discards the preview and leaves the box alone", async () => {
    await make();
    type("fix the totl");
    await click("Improve with AI");
    await click("Edit");
    await act(async () => {
      fireEvent.keyDown(screen.getByRole("textbox", { name: "After" }), { key: "Escape" });
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(box().value).toBe("fix the totl");
  });

  test("Retry sends the same text again and shows the new answer", async () => {
    let n = 0;
    const { fake } = await make({
      run: (request) => ({ ...ANSWER, text: `Answer ${++n}`, model: request.model }),
    });
    type("fix the totl");
    await click("Improve with AI");
    const first = await screen.findByRole("dialog", { name: "AI suggestion" });
    expect(within(first).queryByText("Answer 1")).not.toBeNull();
    await click("Retry");
    await settle(() => screen.queryByText("Answer 2") !== null);
    expect(asked(fake)).toHaveLength(2);
    const sent = asked(fake).map((call) => (call[1] as { user: string }).user);
    expect(sent[1]).toBe(sent[0]);
    expect(box().value).toBe("fix the totl");
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

  test("after Accept an Undo chip puts the old text back and goes away", async () => {
    await make();
    type("fix the totl");
    await accepted();
    expect(screen.queryByText("Text replaced by AI.")).not.toBeNull();
    await click("Undo");
    expect(box().value).toBe("fix the totl");
    expect(screen.queryByText("Text replaced by AI.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  test("Ctrl+Z and Cmd+Z in the box undo the accepted text and are not typed; Shift and a later edit do not", async () => {
    await make();
    type("fix the totl");
    await accepted();
    let notPrevented = true;
    await act(async () => {
      notPrevented = fireEvent.keyDown(box(), { key: "z", ctrlKey: true, shiftKey: true });
    });
    expect(notPrevented).toBe(true);
    expect(box().value).toBe("Fix the total.");
    await act(async () => {
      notPrevented = fireEvent.keyDown(box(), { key: "z", ctrlKey: true });
    });
    expect(notPrevented).toBe(false);
    expect(box().value).toBe("fix the totl");
    expect(screen.queryByText("Text replaced by AI.")).toBeNull();
    await act(async () => {
      notPrevented = fireEvent.keyDown(box(), { key: "z", ctrlKey: true });
    });
    expect(notPrevented).toBe(true);
    await accepted();
    await act(async () => {
      notPrevented = fireEvent.keyDown(box(), { key: "Z", metaKey: true });
    });
    expect(notPrevented).toBe(false);
    expect(box().value).toBe("fix the totl");
  });

  test("typing after Accept drops the chip and Ctrl+Z is left to the browser", async () => {
    await make();
    type("fix the totl");
    await accepted();
    type("Fix the total!");
    expect(screen.queryByText("Text replaced by AI.")).toBeNull();
    let notPrevented = false;
    await act(async () => {
      notPrevented = fireEvent.keyDown(box(), { key: "z", ctrlKey: true });
    });
    expect(notPrevented).toBe(true);
    expect(box().value).toBe("Fix the total!");
  });

  test("the chip goes away on its own once its 15 seconds are over", async () => {
    await make();
    type("fix the totl");
    const timers = watchTimers();
    const acceptedAt = Date.now();
    await accepted();
    expect(timers.delays()).toHaveLength(1);
    expect(timers.delays()[0]).toBeGreaterThan(14_000);
    expect(timers.delays()[0]).toBeLessThanOrEqual(15_000);
    expect(screen.queryByText("Text replaced by AI.")).not.toBeNull();
    const spy = spyOn(Date, "now").mockReturnValue(acceptedAt + 16_000);
    await act(async () => timers.fire());
    spy.mockRestore();
    expect(screen.queryByText("Text replaced by AI.")).toBeNull();
    expect(box().value).toBe("Fix the total.");
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

  test("a host the person never agreed to is not sent the text: the click opens Settings, where it asks once", async () => {
    const { store, fake, opened } = await make({}, { configured: false });
    seedHosts(store, [{ id: "h1", name: "alfa", features: ["assistant"] }]);
    const toHost = spyOn(store, "hostRequest").mockResolvedValue({
      ok: true,
      data: ANSWER,
    } as never);
    type("fix the totl");
    await click("Improve with AI");
    expect(opened).toEqual(["settings"]);
    expect(store.assistant.wantsSetup()).toBe(true);
    expect(toHost).not.toHaveBeenCalled();
    expect(asked(fake)).toHaveLength(0);
    expect(screen.queryByRole("status")).toBeNull();
  });

  test("a host the person agreed to gets the click without a detour to Settings", async () => {
    const { store, opened } = await make({}, { configured: false });
    seedHosts(store, [{ id: "h1", name: "alfa", features: ["assistant"] }]);
    store.assistant.confirmHost("h1");
    const toHost = spyOn(store, "hostRequest").mockResolvedValue({
      ok: true,
      data: ANSWER,
    } as never);
    type("fix the totl");
    await click("Improve with AI");
    expect(opened).toEqual([]);
    expect(store.assistant.wantsSetup()).toBe(false);
    expect(toHost.mock.calls.map((call) => [call[0], call[1]])).toEqual([["h1", "assistant.run"]]);
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

  test("a failure offers each other provider that could run, by name, and a click sends the same text there", async () => {
    let failing = true;
    const { store, fake } = await make({
      run: () => {
        if (failing) throw { reason: "assistant_credits" };
        return { ...ANSWER, text: "Fix the total." };
      },
    });
    await fake.assistant.setKey("openrouter", "sk-or-ccccdddd");
    await store.assistant.refreshKeys();
    seedHosts(store, [{ id: "h1", name: "alfa", features: ["assistant"] }]);
    store.assistant.confirmHost("h1");
    const toHost = spyOn(store, "hostRequest").mockResolvedValue({
      ok: true,
      data: { ...ANSWER, text: "Fix the total, from alfa." },
    } as never);
    type("fix the totl");
    await click("Improve with AI");
    const alert = await screen.findByRole("alert");
    expect(within(alert).queryByRole("button", { name: "Try with alfa" })).not.toBeNull();
    expect(
      within(alert).queryByRole("button", { name: "Try with OpenRouter (API key)" }),
    ).not.toBeNull();
    expect(within(alert).queryByRole("button", { name: /Try with Anthropic/ })).toBeNull();
    failing = false;
    await act(async () => {
      fireEvent.click(within(alert).getByRole("button", { name: "Try with OpenRouter (API key)" }));
    });
    await screen.findByRole("dialog", { name: "AI suggestion" });
    const last = asked(fake).at(-1);
    expect(last?.[3]).toMatchObject({ provider: "openrouter" });
    expect(JSON.stringify(last?.[1])).toContain("fix the totl");
    expect(toHost).not.toHaveBeenCalled();
    expect(box().value).toBe("fix the totl");
  });

  test("Try with a host sends the same text to that host, and nowhere else", async () => {
    const { store, fake } = await make({
      run: () => {
        throw { reason: "assistant_credits" };
      },
    });
    seedHosts(store, [{ id: "h1", name: "alfa", features: ["assistant"] }]);
    store.assistant.confirmHost("h1");
    const toHost = spyOn(store, "hostRequest").mockResolvedValue({
      ok: true,
      data: { ...ANSWER, text: "Fix the total, from alfa." },
    } as never);
    type("fix the totl");
    await click("Improve with AI");
    const alert = await screen.findByRole("alert");
    const tryAlfa = within(alert).queryByRole("button", { name: "Try with alfa" });
    expect(tryAlfa).not.toBeNull();
    await act(async () => {
      fireEvent.click(tryAlfa as HTMLElement);
    });
    const dialog = await screen.findByRole("dialog", { name: "AI suggestion" });
    expect(dialog.textContent).toContain("Fix the total, from alfa.");
    expect(toHost.mock.calls.map((call) => [call[0], call[1]])).toEqual([["h1", "assistant.run"]]);
    expect(asked(fake)).toHaveLength(1);
  });

  test("Try with sends the text the failed run had, not what the box holds by now", async () => {
    let first = true;
    const { store, fake } = await make({
      run: () => {
        if (first) {
          first = false;
          throw { reason: "assistant_credits" };
        }
        return { ...ANSWER, text: "Fixed." };
      },
    });
    await fake.assistant.setKey("openrouter", "sk-or-ccccdddd");
    await store.assistant.refreshKeys();
    type("fix the totl");
    await click("Improve with AI");
    const alert = await screen.findByRole("alert");
    type("a different text");
    await act(async () => {
      fireEvent.click(within(alert).getByRole("button", { name: "Try with OpenRouter (API key)" }));
    });
    await screen.findByRole("dialog", { name: "AI suggestion" });
    expect(JSON.stringify(asked(fake).at(-1)?.[1])).toContain("fix the totl");
    expect(JSON.stringify(asked(fake).at(-1)?.[1])).not.toContain("a different text");
  });

  test("the folder of the field goes only to the host of the field, never to another host", async () => {
    for (const [fieldHost, cwd] of [
      ["h0", undefined],
      ["h1", "/work"],
    ] as const) {
      const { store, unmount } = await makeScoped(fieldHost);
      const toHost = spyOn(store, "hostRequest").mockResolvedValue({
        ok: true,
        data: { ...ANSWER, text: "Fixed." },
      } as never);
      type("fix the totl");
      await click("Improve with AI");
      const alert = await screen.findByRole("alert");
      await act(async () => {
        fireEvent.click(within(alert).getByRole("button", { name: "Try with alfa" }));
      });
      await screen.findByRole("dialog", { name: "AI suggestion" });
      const payload = toHost.mock.calls[0]?.[2] as { cwd?: string };
      expect(payload.cwd).toBe(cwd);
      unmount();
    }
  });

  test("a host the person never agreed to, or no other provider at all, offers no Try with", async () => {
    const { store } = await make({
      run: () => {
        throw { reason: "assistant_credits" };
      },
    });
    seedHosts(store, [{ id: "h1", name: "alfa", features: ["assistant"] }]);
    type("fix the totl");
    await click("Improve with AI");
    const alert = await screen.findByRole("alert");
    expect(within(alert).queryByRole("button", { name: /Try with/ })).toBeNull();
    expect(within(alert).queryByRole("button", { name: "Dismiss" })).not.toBeNull();
  });

  test("Try with reads in Portuguese", async () => {
    const { store, fake } = await make(
      {
        run: () => {
          throw { reason: "assistant_credits" };
        },
      },
      { language: "pt-BR" },
    );
    await fake.assistant.setKey("openrouter", "sk-or-ccccdddd");
    await store.assistant.refreshKeys();
    type("corrige o totl");
    await click("Melhorar com IA");
    const alert = await screen.findByRole("alert");
    expect(
      within(alert).queryByRole("button", { name: "Tentar com OpenRouter (chave de API)" }),
    ).not.toBeNull();
  });

  test("Esc in the box cancels a run, closes a preview and dismisses a failure", async () => {
    let answer: (text: string) => void = () => {};
    let fail = false;
    const { fake } = await make({
      run: (request) => {
        if (fail) throw { reason: "assistant_credits" };
        return new Promise((resolve) => {
          answer = (text) => resolve({ ...ANSWER, text, model: request.model });
        });
      },
    });
    type("fix the totl");
    await click("Improve with AI");
    await act(async () => {
      fireEvent.keyDown(box(), { key: "Escape" });
    });
    expect(fake.calls.filter((c) => c[0] === "cancel")).toHaveLength(1);
    expect(screen.queryByRole("status")).toBeNull();
    // The cancelled call ends on its own and gives the one run of the app back.
    await act(async () => answer("Too late."));
    await click("Improve with AI");
    await act(async () => answer("Fix the total."));
    await screen.findByRole("dialog", { name: "AI suggestion" });
    await act(async () => {
      fireEvent.keyDown(box(), { key: "Escape" });
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    fail = true;
    await click("Improve with AI");
    await screen.findByRole("alert");
    await act(async () => {
      fireEvent.keyDown(box(), { key: "Escape" });
    });
    expect(screen.queryByRole("alert")).toBeNull();
    // With nothing open, Esc is the box's own.
    expect(fireEvent.keyDown(box(), { key: "Escape" })).toBe(true);
    expect(box().value).toBe("fix the totl");
  });

  test("a Cancel the provider cannot take is not an error: the wand still closes", async () => {
    const { fake } = await make({ run: () => new Promise(() => {}) });
    fake.assistant.cancel = async () => {
      throw { reason: "assistant_offline" };
    };
    type("fix the totl");
    await click("Improve with AI");
    await click("Cancel");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  test("in a short window the toolbar keeps its room: no button, and Ctrl+I still works", async () => {
    const { fake } = await make({}, { short: true });
    type("fix the totl");
    expect(screen.queryByRole("button", { name: /with AI/ })).toBeNull();
    await act(async () => {
      fireEvent.keyDown(box(), { key: "i", ctrlKey: true });
    });
    await screen.findByRole("dialog", { name: "AI suggestion" });
    expect(asked(fake)).toHaveLength(1);
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
    expect(within(dialog).queryByRole("button", { name: "Editar" })).not.toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Tentar de novo" })).not.toBeNull();
    expect(within(dialog).getByRole("button", { name: "Descartar" })).not.toBeNull();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Aceitar" }));
    });
    expect(screen.queryByText("Texto trocado pela IA.")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Desfazer" })).not.toBeNull();
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
