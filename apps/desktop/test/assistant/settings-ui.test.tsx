import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { ModelOption } from "@flightdeck/protocol";
import {
  AXE_RUN_OPTIONS,
  blocking,
  describeViolation,
} from "../../../../scripts/lib/browser/axe.ts";
import { liveScreen, registerDom } from "../dom.ts";
import { fakeAssistant, memoryPlatform, seedHosts } from "../fixtures.ts";
import { waiter } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { AssistantSettings } = await import("../../src/features/assistant/assistant-settings.tsx");
const { Settings } = await import("../../src/features/settings/page.tsx");
const axe = (await import("axe-core")).default;

setDefaultTimeout(30_000);
afterEach(cleanup);
const settle = waiter(5000);

const ANTHROPIC_MODELS: ModelOption[] = [
  { id: "claude-haiku-5-5", label: "Haiku 5.5", group: "Haiku" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5", group: "Sonnet" },
];
const HOSTS = [
  { id: "h1", name: "alfa", features: ["assistant"] },
  { id: "h2", name: "beta", features: ["assistant"] },
];

function setup(
  options: {
    lang?: "en" | "pt-BR";
    hosts?: typeof HOSTS;
    supported?: boolean;
    api?: Parameters<typeof fakeAssistant>[0];
  } = {},
) {
  const mem = memoryPlatform(false, options.lang ?? "en");
  const fake = fakeAssistant({
    supported: options.supported ?? true,
    models: () => ANTHROPIC_MODELS,
    ...options.api,
  });
  mem.platform.assistant = fake.assistant;
  const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  seedHosts(store, options.hosts ?? HOSTS);
  const opened: string[] = [];
  mem.platform.openExternal = async (url) => void opened.push(url);
  const view = render(<AssistantSettings store={store} t={store.i18n.t} />);
  return { store, fake, opened, view };
}

const click = (el: HTMLElement | null) =>
  act(async () => {
    if (el) fireEvent.click(el);
  });
const radio = (name: string) => screen.getByRole("radio", { name }) as HTMLInputElement;
const button = (name: string | RegExp) => screen.queryByRole("button", { name });
const keyInput = (name: string) => screen.queryByLabelText(name) as HTMLInputElement | null;

describe("assistant-settings-ui: the provider, in words", () => {
  test("three providers, each with the line that says where the text goes; the host line names the host", () => {
    setup();
    expect(radio("Claude Code on a host")).toBeDefined();
    expect(radio("Anthropic (API key)")).toBeDefined();
    expect(radio("OpenRouter (API key)")).toBeDefined();
    const text = document.body.textContent ?? "";
    expect(text).toContain(
      "Your text goes to Anthropic through the Claude Code signed in on alfa. That host sees it and its plan pays for it.",
    );
    expect(text).toContain("Your text goes to api.anthropic.com with your key.");
    expect(text).toContain(
      "Your text goes to openrouter.ai, which sends it to the provider of the model you pick.",
    );
  });

  test("each provider radio is described by its privacy line (#3866)", () => {
    setup();
    const described = (name: string) =>
      document.getElementById(radio(name).getAttribute("aria-describedby") ?? "")?.textContent;
    expect([
      described("Claude Code on a host"),
      described("Anthropic (API key)"),
      described("OpenRouter (API key)"),
    ]).toEqual([
      "Your text goes to Anthropic through the Claude Code signed in on alfa. That host sees it and its plan pays for it.",
      "Your text goes to api.anthropic.com with your key.",
      "Your text goes to openrouter.ai, which sends it to the provider of the model you pick.",
    ]);
  });

  test("the host radio with no usable host is described by the no-host line (#3866)", () => {
    setup({ hosts: [] });
    const line = document.getElementById(
      radio("Claude Code on a host").getAttribute("aria-describedby") ?? "",
    )?.textContent;
    expect(line).toBe(
      "Your text goes to Anthropic through the Claude Code signed in on the host you pick.",
    );
  });

  test("the choice is kept in the preferences, and the wand can be switched off", async () => {
    const { store } = setup();
    await click(radio("OpenRouter (API key)"));
    expect(store.assistant.prefs().provider).toBe("openrouter");
    expect(radio("OpenRouter (API key)").checked).toBe(true);
    const wand = screen.getByRole("checkbox", {
      name: "Show the AI button on text fields",
    }) as HTMLInputElement;
    expect(wand.checked).toBe(true);
    await click(wand);
    expect(store.assistant.prefs().enabled).toBe(false);
  });

  test("a host picker appears with several hosts, and the first use of a host asks once, naming it", async () => {
    const { store } = setup();
    const picker = screen.getByRole("combobox", { name: "Host" }) as HTMLSelectElement;
    expect([...picker.options].map((o) => o.textContent)).toEqual(["alfa", "beta"]);
    await click(radio("Claude Code on a host"));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("alfa");
    await click(within(dialog).getByRole("button", { name: /^Cancel/ }));
    expect(store.assistant.prefs().confirmedHosts).toEqual([]);
    expect(store.assistant.prefs().provider).toBeNull();
    await click(radio("Claude Code on a host"));
    await click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Use alfa" }));
    expect(store.assistant.prefs()).toMatchObject({
      provider: "host",
      hostId: "h1",
      confirmedHosts: ["h1"],
    });
    // The same host does not ask again; another one does.
    await click(radio("Anthropic (API key)"));
    await click(radio("Claude Code on a host"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await act(async () => {
      fireEvent.change(picker, { target: { value: "h2" } });
    });
    expect(
      within(screen.getByRole("alertdialog")).queryByRole("button", { name: "Use beta" }),
    ).not.toBeNull();
  });

  test("with one host there is no picker; with none the provider says so", () => {
    setup({ hosts: [HOSTS[0] as (typeof HOSTS)[number]] });
    expect(screen.queryByRole("combobox", { name: "Host" })).toBeNull();
    cleanup();
    setup({ hosts: [] });
    expect(document.body.textContent).toContain("No host with the assistant is online.");
  });

  test("the web build offers only Claude Code on a host, and says why", () => {
    setup({ supported: false });
    expect(screen.queryByRole("radio", { name: "Anthropic (API key)" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "OpenRouter (API key)" })).toBeNull();
    expect(document.body.textContent).toContain(
      "The web version can only use Claude Code on a host.",
    );
  });
});

describe("assistant-settings-ui: the keys", () => {
  test("a pasted key is stored once, the field is cleared, and only its last four characters are shown", async () => {
    const { fake } = setup();
    await settle(() => keyInput("Anthropic key") !== null);
    const field = keyInput("Anthropic key");
    expect(field?.type).toBe("password");
    await act(async () => {
      fireEvent.change(field as HTMLInputElement, {
        target: { value: "sk-ant-api03-0123456789wxyz" },
      });
    });
    await click(
      within(screen.getByRole("group", { name: "Anthropic" })).queryByRole("button", {
        name: "Save key",
      }),
    );
    await settle(() => document.body.textContent?.includes("Key saved · …wxyz") === true);
    expect(fake.calls.filter((c) => c[0] === "setKey")).toEqual([["setKey", "anthropic"]]);
    expect(keyInput("Anthropic key")).toBeNull();
    expect(document.body.innerHTML).not.toContain("sk-ant-api03-0123456789wxyz");
  });

  test("Replace asks for a new key, Remove asks first and then deletes", async () => {
    // A fresh screen over a store that already has a key saved.
    const mem = memoryPlatform(false, "en");
    const fake2 = fakeAssistant({ models: () => ANTHROPIC_MODELS });
    await fake2.assistant.setKey("anthropic", "sk-ant-aaaabbbb");
    mem.platform.assistant = fake2.assistant;
    const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
    store.i18n.start();
    seedHosts(store, HOSTS);
    render(<AssistantSettings store={store} t={store.i18n.t} />);
    await settle(() => document.body.textContent?.includes("Key saved · …bbbb") === true);
    await click(button("Replace"));
    expect(keyInput("Anthropic key")).not.toBeNull();
    await click(button("Cancel"));
    expect(keyInput("Anthropic key")).toBeNull();
    // Cancel in the confirmation leaves the key where it is.
    await click(button("Remove"));
    await click(within(screen.getByRole("alertdialog")).getByRole("button", { name: /^Cancel/ }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(fake2.calls.some((c) => c[0] === "deleteKey")).toBe(false);
    await click(button("Remove"));
    const dialog = screen.getByRole("alertdialog");
    expect(fake2.calls.some((c) => c[0] === "deleteKey")).toBe(false);
    await click(within(dialog).getByRole("button", { name: "Remove" }));
    await settle(() => keyInput("Anthropic key") !== null);
    expect(fake2.calls.filter((c) => c[0] === "deleteKey")).toEqual([["deleteKey", "anthropic"]]);
  });

  test("Test says the result in words, and never the key", async () => {
    const results = [
      { ok: true },
      { ok: false, detail: "assistant_auth" },
      { ok: false, detail: "assistant_credits" },
      { ok: false, detail: "assistant_offline" },
    ];
    let n = 0;
    const mem = memoryPlatform(false, "en");
    const fake = fakeAssistant({ test: async () => results[n++] as never });
    await fake.assistant.setKey("anthropic", "sk-ant-aaaabbbb");
    mem.platform.assistant = fake.assistant;
    const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
    store.i18n.start();
    seedHosts(store, HOSTS);
    render(<AssistantSettings store={store} t={store.i18n.t} />);
    await settle(() => button("Test") !== null);
    const said: string[] = [];
    for (let i = 0; i < 4; i++) {
      await click(button("Test"));
      await settle(() => (screen.queryByRole("status")?.textContent ?? "") !== (said.at(-1) ?? ""));
      said.push(screen.queryByRole("status")?.textContent ?? "");
    }
    expect(said).toEqual([
      "The key works.",
      "The provider refused the key. Check it in Settings, Assistant.",
      "The provider says there is no credit left on this key.",
      "The provider cannot be reached. Check the connection.",
    ]);
    expect(document.body.innerHTML).not.toContain("sk-ant-aaaabbbb");
  });

  test("a Test that fails with no reason of ours says the key could not be tested", async () => {
    const mem = memoryPlatform(false, "en");
    const fake = fakeAssistant({ test: async () => ({ ok: false, detail: "HTTP 401" }) as never });
    await fake.assistant.setKey("anthropic", "sk-ant-aaaabbbb");
    mem.platform.assistant = fake.assistant;
    const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
    store.i18n.start();
    seedHosts(store, HOSTS);
    render(<AssistantSettings store={store} t={store.i18n.t} />);
    await settle(() => button("Test") !== null);
    await click(button("Test"));
    await settle(() => (screen.queryByRole("status")?.textContent ?? "") !== "");
    expect(screen.queryByRole("status")?.textContent).toBe("The key could not be tested.");
  });

  test("a Test the shell rejects is said in words too", async () => {
    const mem = memoryPlatform(false, "en");
    const fake = fakeAssistant({
      test: async () => {
        throw { reason: "assistant_timeout" };
      },
    });
    await fake.assistant.setKey("anthropic", "sk-ant-aaaabbbb");
    mem.platform.assistant = fake.assistant;
    const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
    store.i18n.start();
    seedHosts(store, HOSTS);
    render(<AssistantSettings store={store} t={store.i18n.t} />);
    await settle(() => button("Test") !== null);
    await click(button("Test"));
    await settle(() => (screen.queryByRole("status")?.textContent ?? "") !== "");
    expect(screen.queryByRole("status")?.textContent).toBe(
      store.i18n.t("assistantRefusal.assistant_timeout"),
    );
  });

  test("a key the shell refuses is explained in words", async () => {
    setup({
      api: {
        setKey: () => {
          throw { reason: "assistant_key_invalid", params: { why: "whitespace" } };
        },
      },
    });
    await settle(() => keyInput("Anthropic key") !== null);
    await act(async () => {
      fireEvent.change(keyInput("Anthropic key") as HTMLInputElement, {
        target: { value: "sk ant" },
      });
    });
    await click(
      within(screen.getByRole("group", { name: "Anthropic" })).queryByRole("button", {
        name: "Save key",
      }),
    );
    await settle(() => screen.queryByRole("alert") !== null);
    expect(screen.queryByRole("alert")?.textContent).toContain(
      "That is not a usable key: it has a space or a line break",
    );
    expect(keyInput("Anthropic key")).not.toBeNull();
  });

  test("OpenRouter has the switch for providers that do not collect data (on by default) and a link to its privacy page", async () => {
    const { store, opened } = setup();
    const only = screen.getByRole("checkbox", {
      name: "Only providers that do not collect data",
    }) as HTMLInputElement;
    expect(only.checked).toBe(true);
    await click(only);
    expect(store.assistant.prefs().openrouterPrivate).toBe(false);
    await click(button("OpenRouter's privacy page (opens the browser)"));
    expect(opened).toEqual(["https://openrouter.ai/docs/guides/privacy/data-collection"]);
  });

  test("the Linux note is shown on Linux only", () => {
    const real = Object.getOwnPropertyDescriptor(window.navigator, "userAgent");
    const set = (ua: string) =>
      Object.defineProperty(window.navigator, "userAgent", { value: ua, configurable: true });
    try {
      set("Mozilla/5.0 (X11; Linux x86_64)");
      setup();
      expect(document.body.textContent).toContain(
        "On Linux the key is kept in memory by the system and is lost at a reboot.",
      );
      cleanup();
      set("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
      setup();
      expect(document.body.textContent).not.toContain("On Linux the key");
    } finally {
      if (real) Object.defineProperty(window.navigator, "userAgent", real);
    }
  });
});

describe("assistant-settings-ui: the models and the profiles", () => {
  test("each profile has a picker; the list comes from the provider and the choice is kept", async () => {
    const { store, fake } = setup();
    await click(radio("Anthropic (API key)"));
    await settle(() => fake.calls.some((c) => c[0] === "models"));
    await settle(() => screen.queryByRole("combobox", { name: "Quick model" }) !== null);
    await click(screen.getAllByRole("option", { name: /Sonnet 5.5/ })[0] as HTMLElement);
    expect(store.assistant.prefs().models.anthropic?.quick).toBe("claude-sonnet-5-5");
    // The default row clears the choice.
    await click(
      screen.getAllByRole("option", {
        name: /Provider default|Suggested default/,
      })[0] as HTMLElement,
    );
    expect(store.assistant.prefs().models.anthropic?.quick).toBeUndefined();
  });

  test("a list of models that cannot be read says so and offers Try again, which reads it again", async () => {
    let attempts = 0;
    const { fake } = setup({
      api: {
        models: () => {
          attempts++;
          if (attempts === 1) throw { reason: "assistant_offline" };
          return ANTHROPIC_MODELS;
        },
      },
    });
    await click(radio("Anthropic (API key)"));
    await settle(() => screen.queryAllByRole("alert").length > 0);
    await click(screen.getAllByRole("button", { name: "Try again" })[0] as HTMLElement);
    await settle(() => screen.queryByRole("combobox", { name: "Quick model" }) !== null);
    expect(fake.calls.filter((c) => c[0] === "models").length).toBeGreaterThanOrEqual(2);
  });

  test("a list that cannot be read gives the reason, and with no key says to save one", async () => {
    setup({
      api: {
        models: () => {
          throw { reason: "assistant_offline" };
        },
      },
    });
    await click(radio("Anthropic (API key)"));
    await settle(() => screen.queryAllByRole("alert").length > 0);
    const offline = screen.getAllByRole("alert")[0]?.textContent ?? "";
    expect(offline).toContain("Could not load the models.");
    expect(offline).toContain("The provider cannot be reached. Check the connection.");
    cleanup();
    setup({
      api: {
        models: () => {
          throw { reason: "assistant_not_configured" };
        },
      },
    });
    await click(radio("Anthropic (API key)"));
    await settle(() => screen.queryAllByRole("alert").length > 0);
    const none = screen.getAllByRole("alert")[0]?.textContent ?? "";
    expect(none).toContain("Save a key above to see the models.");
    expect(none).not.toContain("Choose an AI provider");
  });

  test("each profile says what it is used for and which model is in use", async () => {
    const { store } = setup();
    await click(radio("Anthropic (API key)"));
    await settle(() => screen.queryByRole("combobox", { name: "Quick model" }) !== null);
    const hints = () => document.body.textContent ?? "";
    expect(hints()).toContain("Used for: Prompt for a session, Request in Simple mode, Card title");
    expect(hints()).toContain("Commit message");
    expect(hints()).toContain("Model in use: Haiku 5.5");
    expect(hints()).toContain("Model in use: Sonnet 5.5");
    await click(screen.getAllByRole("option", { name: /Sonnet 5.5/ })[0] as HTMLElement);
    expect(store.assistant.prefs().models.anthropic?.quick).toBe("claude-sonnet-5-5");
    expect(hints()).not.toContain("Model in use: Haiku 5.5");
  });

  test("a profile that moves in Advanced moves in the hints too", async () => {
    setup();
    await click(radio("Anthropic (API key)"));
    await settle(() => screen.queryByRole("combobox", { name: "Quick model" }) !== null);
    await click(button("Advanced"));
    await act(async () => {
      fireEvent.change(within(screen.getByRole("table")).getByLabelText("Card title"), {
        target: { value: "careful" },
      });
    });
    const used = Array.from(document.querySelectorAll("p"))
      .map((p) => p.textContent ?? "")
      .filter((text) => text.startsWith("Used for:"));
    expect(used).toHaveLength(2);
    expect(used[0]?.includes("Card title")).toBe(false);
    expect(used[1]?.includes("Card title")).toBe(true);
  });

  test("a profile no kind of text uses says nothing about what it is used for", async () => {
    setup();
    await click(radio("Anthropic (API key)"));
    await settle(() => screen.queryByRole("combobox", { name: "Quick model" }) !== null);
    await click(button("Advanced"));
    const table = within(screen.getByRole("table"));
    for (const select of table.getAllByRole("combobox")) {
      await act(async () => {
        fireEvent.change(select, { target: { value: "careful" } });
      });
    }
    expect(document.body.textContent).not.toContain("Used for: .");
  });

  test("the models are read again once the key is saved", async () => {
    let keyed = false;
    setup({
      api: {
        setKey: () => {
          keyed = true;
        },
        models: () => {
          if (!keyed) throw { reason: "assistant_not_configured" };
          return ANTHROPIC_MODELS;
        },
      },
    });
    await click(radio("Anthropic (API key)"));
    await settle(() => document.body.textContent?.includes("Save a key above") === true);
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Anthropic key"), {
        target: { value: "sk-ant-aaaabbbb" },
      });
    });
    await click(
      within(screen.getByRole("group", { name: "Anthropic" })).getByRole("button", {
        name: "Save key",
      }),
    );
    await settle(() => document.body.textContent?.includes("Key saved · …bbbb") === true);
    await act(async () => {});
    expect(screen.queryByRole("combobox", { name: "Quick model" })).not.toBeNull();
    expect(document.body.textContent).not.toContain("Save a key above");
  });

  test("a host that was agreed to already is chosen from the picker without asking again", async () => {
    const { store } = setup();
    await act(async () => {
      store.assistant.setPrefs({ confirmedHosts: ["h2"] });
    });
    const picker = screen.getByRole("combobox", { name: "Host" }) as HTMLSelectElement;
    await act(async () => {
      fireEvent.change(picker, { target: { value: "h2" } });
    });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(store.assistant.prefs().hostId).toBe("h2");
  });

  test("the host provider lists four fixed models and no effort choice", async () => {
    setup();
    await click(radio("Claude Code on a host"));
    await click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Use alfa" }));
    expect(screen.getAllByRole("option", { name: /Haiku 5.5/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("option", { name: /Opus 5.5/ }).length).toBeGreaterThan(0);
    // The newest Fable is offered, not the one it replaced.
    expect(screen.getAllByRole("option", { name: /Fable 5.2/ }).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole("option", { name: /Fable 5.1/ })).toHaveLength(0);
    expect(screen.queryByLabelText("Effort")).toBeNull();
  });

  test("Advanced is collapsed, and its table gives each kind a profile that is kept", async () => {
    const { store } = setup();
    expect(screen.queryByRole("table")).toBeNull();
    await click(button("Advanced"));
    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row");
    expect(rows.length).toBe(1 + 12); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    const select = within(table).getByLabelText("Card title") as HTMLSelectElement;
    expect(select.value).toBe("quick");
    await act(async () => {
      fireEvent.change(select, { target: { value: "careful" } });
    });
    expect(store.assistant.prefs().profiles["card.title"]).toBe("careful");
  });
});

describe("assistant-settings-ui: the section in Settings, in both languages", () => {
  function settings(lang: "en" | "pt-BR") {
    const mem = memoryPlatform(false, lang);
    mem.platform.assistant = fakeAssistant({ models: () => [] }).assistant;
    const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
    store.i18n.start();
    seedHosts(store, HOSTS);
    render(
      <Settings
        store={store}
        settings={store.getState().settings}
        onCloseToTray={() => {}}
        onAutostart={() => {}}
        onGlobalShortcut={() => {}}
        onShortcuts={() => {}}
        appUpdate={{ upToDate: false } as never}
        onCheckUpdate={() => {}}
        onNotifyUpdates={() => {}}
        onAutoUpdate={() => {}}
        theme="system"
        onTheme={() => {}}
        density="comfortable"
        onDensity={() => {}}
        lang={lang}
        onLang={() => {}}
        t={store.i18n.t}
      />,
    );
    return store;
  }

  test("the rail has the section and the search finds it by its words", async () => {
    settings("en");
    const rail = screen.getByRole("navigation", { name: "Settings sections" });
    expect(within(rail).queryByRole("button", { name: "AI assistant" })).not.toBeNull();
    await act(async () => {
      fireEvent.change(screen.getByRole("searchbox", { name: "Search settings" }), {
        target: { value: "openrouter" },
      });
    });
    expect(
      within(rail)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["AI assistant"]);
    expect(screen.getByRole("region", { name: "AI assistant" })).toBeDefined();
  });

  test("in Portuguese the section, the providers and the key flow read in Portuguese", async () => {
    settings("pt-BR");
    await settle(() => screen.queryByLabelText("Chave da Anthropic") !== null);
    const rail = screen.getByRole("navigation", { name: "Seções das configurações" });
    expect(within(rail).queryByRole("button", { name: "Assistente de IA" })).not.toBeNull();
    expect(screen.getByRole("radio", { name: "Claude Code em um host" })).toBeDefined();
    expect(screen.getByRole("radio", { name: "Anthropic (chave de API)" })).toBeDefined();
    expect(
      screen.getByRole("checkbox", { name: "Mostrar o botão de IA nos campos de texto" }),
    ).toBeDefined();
    expect(screen.getByLabelText("Chave da Anthropic")).toBeDefined();
    expect(document.body.textContent).toContain(
      "Seu texto vai para api.anthropic.com com a sua chave.",
    );
  });

  test("it has nothing axe blocks", async () => {
    setup();
    const result = await axe.run(document.body, AXE_RUN_OPTIONS);
    expect(
      blocking(result.violations as Parameters<typeof blocking>[0]).map((v) =>
        describeViolation("assistant-settings", v),
      ),
    ).toEqual([]);
  });
});

describe("settings: the AI button is named by what the person sees (issue #4167)", () => {
  test("the switch, the hint and the setup notice say the AI button, and the hint gives the shortcut", () => {
    setup();
    expect(
      screen.queryByRole("checkbox", { name: "Show the AI button on text fields" }),
    ).not.toBeNull();
    expect(document.body.textContent).not.toContain("wand");
    expect(document.body.textContent).toContain("Ctrl+I");
  });

  test("in Portuguese too", () => {
    setup({ lang: "pt-BR" });
    expect(
      screen.queryByRole("checkbox", { name: "Mostrar o botão de IA nos campos de texto" }),
    ).not.toBeNull();
    expect(document.body.textContent).not.toContain("varinha");
    expect(document.body.textContent).toContain("Ctrl+I");
  });

  test("the privacy link says it opens the browser", () => {
    setup();
    expect(button("OpenRouter's privacy page (opens the browser)")).not.toBeNull();
  });

  test("the Advanced toggle names the content it opens", async () => {
    setup();
    const toggle = button("Advanced") as HTMLElement;
    await click(toggle);
    const id = toggle.getAttribute("aria-controls");
    expect(id).not.toBeNull();
    expect(document.getElementById(id as string)?.querySelector("table")).not.toBeNull();
  });
});
