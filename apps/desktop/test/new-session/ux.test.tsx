import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { poll } from "../../../daemon/test/support/helpers.ts";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";
import { personasHost } from "../personas/ui-setup.ts";
import { settle, settleMaybe, uiIdle } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { App } = await import("../../src/app/App.tsx");
const { NewSessionForm } = await import("../../src/features/sessions/new-session-form.tsx");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const fill = async (label: string, value: string) => {
  const field = screen.queryByLabelText(label);
  expect(field).not.toBeNull();
  await act(async () => {
    fireEvent.change(field as HTMLElement, { target: { value } });
  });
  await uiIdle();
};
const press = async (name: string) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};

/** The app in English on a real daemon with the pack's personas, on "+ New session". */
async function open() {
  const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const h = await personasHost(cleanups, store);
  render(<App store={store} />);
  await settle(() => store.getState().hosts[0]?.hostInfo?.features?.includes("personas") === true);
  await act(async () => {
    store.router.push({ name: "new-session", host: h.hostId });
  });
  await settle(() => screen.queryByLabelText("Persona") !== null);
  return { store, ...h };
}

describe("nova-sessao-ux: the persona chosen is the persona the session is in", () => {
  test("choosing Architect opens the session in it, and the session says so", async () => {
    const { d } = await open();
    await settle(() =>
      [...((screen.queryByLabelText("Persona") as HTMLSelectElement).options ?? [])].some(
        (o) => o.textContent === "Architect",
      ),
    );
    await fill("Persona", "host:architect");
    await fill("First prompt", "desenhe o módulo");
    await press("Create session");
    await poll(() => d.manager.list().length === 1);
    expect(d.manager.list()[0]?.persona).toMatchObject({ id: "architect", name: "Architect" });
    // The session's own screen shows the persona it runs in, and offers to leave it.
    await settle(() => screen.queryByRole("button", { name: "Persona: Architect" }) !== null);
    await act(async () => {
      fireEvent.click(screen.queryByRole("button", { name: "Persona: Architect" }) as HTMLElement);
    });
    expect(screen.queryByRole("button", { name: "Back to normal" })).not.toBeNull();
  });

  test("a session opened with no persona shows none", async () => {
    const { d } = await open();
    await fill("First prompt", "oi");
    await press("Create session");
    await poll(() => d.manager.list().length === 1);
    // Issue #183: the button names the persona it is in, and says None when there is none.
    await settle(() => screen.queryByRole("button", { name: "Persona: None" }) !== null);
    await act(async () => {
      fireEvent.click(screen.queryByRole("button", { name: "Persona: None" }) as HTMLElement);
    });
    await settle(() => screen.queryByRole("button", { name: "Apply" }) !== null, 10_000);
    expect(screen.queryByRole("button", { name: "Back to normal" })).toBeNull();
    // Creating a session and opening its screen chains several waits: the limit guards a hang.
  });
});

describe("nova-sessao-ux: the form says what it needs", () => {
  const host = {
    id: "h1",
    name: "pc",
    info: { allowedRoots: ["/work"] },
  } as unknown as Parameters<typeof NewSessionForm>[0]["host"];

  test("the first prompt is optional: with none the session is created idle, with one it is sent", async () => {
    const created: unknown[] = [];
    const { TContext } = await import("../../src/i18n/context.tsx");
    const { translator } = await import("../../src/i18n/index.ts");
    render(
      <TContext.Provider value={translator("en")}>
        <NewSessionForm host={host} onCreate={(payload) => void created.push(payload)} />
      </TContext.Provider>,
    );
    const button = () =>
      screen.queryByRole("button", { name: "Create session" }) as HTMLButtonElement | null;
    expect(button()?.disabled).toBe(false);
    expect(screen.queryByRole("heading", { name: "New session on pc" })).not.toBeNull();
    await fill("First prompt", "   ");
    expect(button()?.disabled).toBe(false);
    await press("Create session");
    expect(created).toEqual([{ cwd: "/work", permissionMode: "default" }]);
    await fill("First prompt", "faça isto");
    await press("Create session");
    expect(created[1]).toEqual({ cwd: "/work", prompt: "faça isto", permissionMode: "default" });
  });

  // #731: the form was taller than the window inside a pane that does not scroll, so Create
  // session sat below it and only Tab reached it. It is a page now: its title is the page's, its
  // body scrolls, and its buttons stay at the bottom of the window.
  test("the form is a page whose body scrolls, and Create session stays at the bottom of the window", async () => {
    const { TContext } = await import("../../src/i18n/context.tsx");
    const { translator } = await import("../../src/i18n/index.ts");
    render(
      <TContext.Provider value={translator("en")}>
        <NewSessionForm host={host} onCreate={() => {}} />
      </TContext.Provider>,
    );
    const title = screen.queryByRole("heading", { name: "New session on pc" });
    const form = screen.queryByRole("button", { name: "Create session" })?.closest("form");
    const create = screen.queryByRole("button", { name: "Create session" });
    expect({
      title: title?.closest("[data-slot='page-header']") !== null && title !== null,
      scrolls:
        form?.closest("[data-slot='page-body']")?.closest("[data-slot='scroll-area']") != null,
      sticky: create?.closest("[data-sticky-actions]") != null,
    }).toEqual({ title: true, scrolls: true, sticky: true });
  });

  test("a Model select sits by the permission mode: the default sends none, a choice sends it", async () => {
    const created: Array<Record<string, unknown>> = [];
    const { TContext } = await import("../../src/i18n/context.tsx");
    const { translator } = await import("../../src/i18n/index.ts");
    render(
      <TContext.Provider value={translator("en")}>
        <NewSessionForm host={host} onCreate={(payload) => void created.push(payload)} />
      </TContext.Provider>,
    );
    const model = screen.queryByLabelText("Model") as HTMLSelectElement;
    expect(Array.from(model.options).map((o) => o.value)).toEqual(["", "opus", "sonnet", "haiku"]);
    await press("Create session");
    expect(created[0]).not.toHaveProperty("model");
    await fill("Model", "sonnet");
    await press("Create session");
    expect(created[1]?.model).toBe("sonnet");
  });

  test("while the session is being created the button is busy and a second click creates nothing", async () => {
    const created: unknown[] = [];
    let open: () => void = () => {};
    const slow = new Promise<void>((resolve) => {
      open = resolve;
    });
    const { TContext } = await import("../../src/i18n/context.tsx");
    const { translator } = await import("../../src/i18n/index.ts");
    render(
      <TContext.Provider value={translator("en")}>
        <NewSessionForm
          host={host}
          onCreate={(payload) => {
            created.push(payload);
            return slow;
          }}
        />
      </TContext.Provider>,
    );
    await fill("First prompt", "faça isto");
    await press("Create session");
    expect(
      screen.queryByRole("button", { name: /Create session/ })?.getAttribute("aria-busy"),
    ).toBe("true");
    await press("Create session");
    expect(created).toHaveLength(1);
    open();
    await settle(
      () => !screen.queryByRole("button", { name: /Create session/ })?.hasAttribute("aria-busy"),
    );
  });

  test("a host with no allowed folder says so instead of a silent button", async () => {
    const { TContext } = await import("../../src/i18n/context.tsx");
    const { translator } = await import("../../src/i18n/index.ts");
    const empty = { id: "h2", name: "vazio", info: { allowedRoots: [] } } as unknown as typeof host;
    render(
      <TContext.Provider value={translator("en")}>
        <NewSessionForm host={empty} onCreate={() => {}} />
      </TContext.Provider>,
    );
    await fill("First prompt", "faça isto");
    expect(
      (screen.queryByRole("button", { name: "Create session" }) as HTMLButtonElement | null)
        ?.disabled,
    ).toBe(true);
    // The reason is in the Folder field and under the button (#4388).
    expect(screen.queryAllByText("This host has no allowed folder.")).toHaveLength(2);
  });

  // #4388: the Folder field says the dead end where it is, instead of an empty select.
  for (const [language, folder, reason, add] of [
    ["en", "Folder", "This host has no allowed folder.", "Add a folder on vazio's page"],
    [
      "pt-BR",
      "Pasta",
      "Este host não tem pasta permitida.",
      "Adicionar uma pasta na página de vazio",
    ],
  ] as const) {
    test(`a host with no allowed folder shows the reason and the add link in the Folder field, with no empty select (${language}, #4388)`, async () => {
      const { TContext } = await import("../../src/i18n/context.tsx");
      const { translator } = await import("../../src/i18n/index.ts");
      const empty = {
        id: "h2",
        name: "vazio",
        info: { allowedRoots: [] },
      } as unknown as typeof host;
      const added: string[] = [];
      render(
        <TContext.Provider value={translator(language)}>
          <NewSessionForm host={empty} onCreate={() => {}} onAddFolder={() => added.push("add")} />
        </TContext.Provider>,
      );
      expect(screen.queryByRole("combobox", { name: folder })).toBeNull();
      const field = screen.queryByText(folder)?.parentElement ?? null;
      expect(field?.textContent).toContain(reason);
      const link = within(field as HTMLElement).queryByRole("button", { name: add });
      expect(link).not.toBeNull();
      await act(async () => {
        fireEvent.click(link as HTMLElement);
      });
      expect(added).toEqual(["add"]);
      // The button keeps its reason as text; the link is in the field only, so the Tab order has one stop for it.
      expect(screen.queryAllByRole("button", { name: add })).toHaveLength(1);
    });
  }

  test("a host with no allowed folder offers no Browse button, since no session can start there (#4388)", async () => {
    const { TContext } = await import("../../src/i18n/context.tsx");
    const { translator } = await import("../../src/i18n/index.ts");
    const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 60_000 });
    cleanups.push(() => store.dispose());
    const hostWith = (allowedRoots: string[]) =>
      ({
        id: "h2",
        name: "vazio",
        info: { allowedRoots },
        hostInfo: { features: ["fs.dirs"] },
      }) as unknown as typeof host;
    const view = render(
      <TContext.Provider value={translator("en")}>
        <NewSessionForm host={hostWith(["/work"])} store={store} onCreate={() => {}} />
      </TContext.Provider>,
    );
    expect(screen.queryByRole("button", { name: "Browse…" })).not.toBeNull();
    view.rerender(
      <TContext.Provider value={translator("en")}>
        <NewSessionForm host={hostWith([])} store={store} onCreate={() => {}} />
      </TContext.Provider>,
    );
    expect(screen.queryByRole("button", { name: "Browse…" })).toBeNull();
  });

  test("every field of the form has the same width, and the button sits at the fields' left edge", async () => {
    const { TContext } = await import("../../src/i18n/context.tsx");
    const { translator } = await import("../../src/i18n/index.ts");
    const { container } = render(
      <TContext.Provider value={translator("en")}>
        <NewSessionForm host={host} onCreate={() => {}} extra={<select aria-label="Persona" />} />
      </TContext.Provider>,
    );
    const fields = [...container.querySelectorAll("select, input, textarea")].filter(
      (el) => !el.closest("[aria-label='Persona']") && el.getAttribute("aria-label") !== "Persona",
    );
    expect(fields.length).toBeGreaterThan(4);
    const narrow = fields.filter((el) => !/\bw-full\b/.test(el.className));
    expect(narrow.map((el) => el.tagName)).toEqual([]);
    const actions = container.querySelector("form[data-variant='page'] [data-actions]");
    expect(actions?.querySelector("button[type='submit']")).not.toBeNull();
    expect(actions?.className ?? "").toContain("justify-start");
  });

  test("a host whose folders arrive after the form opened is not left with no folder", async () => {
    const created: unknown[] = [];
    const { TContext } = await import("../../src/i18n/context.tsx");
    const { translator } = await import("../../src/i18n/index.ts");
    const loading = { id: "h3", name: "novo" } as unknown as typeof host;
    const form = (h: typeof host) => (
      <TContext.Provider value={translator("en")}>
        <NewSessionForm host={h} onCreate={(payload) => void created.push(payload)} />
      </TContext.Provider>
    );
    const view = render(form(loading));
    await fill("First prompt", "faça isto");
    view.rerender(form(host));
    await settle(
      () =>
        (screen.queryByRole("button", { name: "Create session" }) as HTMLButtonElement | null)
          ?.disabled === false,
    );
    const button = screen.queryByRole("button", {
      name: "Create session",
    }) as HTMLButtonElement | null;
    expect(button?.disabled).toBe(false);
    expect(screen.queryByText("This host has no allowed folder.")).toBeNull();
    await press("Create session");
    expect(created).toEqual([{ cwd: "/work", prompt: "faça isto", permissionMode: "default" }]);
  });
});

// #4469: the OpenCode model list came back empty for a refusal, a real empty answer and the wait alike.
describe("nova-sessao-ux: the OpenCode model list says what it is doing (#4469)", () => {
  const withOpenCode = {
    id: "h1",
    name: "pc",
    info: { allowedRoots: ["/work"] },
    hostInfo: { runtimes: [{ kind: "opencode", available: true }] },
  } as unknown as Parameters<typeof NewSessionForm>[0]["host"];

  type Answer = Awaited<ReturnType<InstanceType<typeof AppStore>["hostRequest"]>>;
  const LIST = { ok: true, data: { models: [{ id: "gpt-x" }, { id: "kimi-y" }] } } as never;
  const EMPTY = { ok: true, data: { models: [] } } as never;
  const REFUSED = { ok: false, code: "internal", message: "no models" } as never;

  /** The form on a host with OpenCode, its model reads answered in order (a promise stays pending). */
  async function openCode(
    answers: Array<Answer | Promise<Answer>>,
    language: "en" | "pt-BR" = "en",
  ) {
    const { TContext } = await import("../../src/i18n/context.tsx");
    const { translator } = await import("../../src/i18n/index.ts");
    const store = new AppStore(memoryPlatform(false, language).platform, { baseDelayMs: 60_000 });
    cleanups.push(() => store.dispose());
    let reads = 0;
    store.hostRequest = (async (_host: string, type: string) => {
      if (type !== "runtime.models") return { ok: true, data: {} };
      return answers[Math.min(reads++, answers.length - 1)];
    }) as never;
    render(
      <TContext.Provider value={translator(language)}>
        <NewSessionForm host={withOpenCode} store={store} onCreate={() => {}} />
      </TContext.Provider>,
    );
    await fill(language === "en" ? "Agent" : "Agente", "opencode");
    return { reads: () => reads };
  }
  const has = (text: string) => screen.queryByText(text) !== null;
  const options = () =>
    Array.from((screen.queryByLabelText("Model") as HTMLSelectElement).options).map((o) => o.value);

  test("while the models are read the field says so, and the default stays selectable", async () => {
    await openCode([new Promise<Answer>(() => {})]);
    expect(has("Reading the OpenCode models…")).toBe(true);
    expect(options()).toEqual([""]);
  });

  test("a refused read says it could not read the models, and Try again reads them again", async () => {
    const w = await openCode([REFUSED, LIST]);
    expect(
      await settleMaybe(
        () => has("Could not read the OpenCode models. The default model is still available."),
        1500,
      ),
    ).toBe(true);
    expect(screen.queryByRole("alert")?.textContent).toContain(
      "Could not read the OpenCode models",
    );
    expect(options()).toEqual([""]);
    await press("Try again");
    expect(await settleMaybe(() => options().includes("gpt-x"), 1500)).toBe(true);
    expect(options()).toEqual(["", "gpt-x", "kimi-y"]);
    expect(w.reads()).toBe(2);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  test("a real empty answer says the host has no models, with no failure and no Try again", async () => {
    await openCode([EMPTY]);
    expect(
      await settleMaybe(
        () => has("This host has no OpenCode models to offer. The default model is used."),
        1500,
      ),
    ).toBe(true);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  test("a list of models is offered with no status line", async () => {
    await openCode([LIST]);
    expect(await settleMaybe(() => options().includes("gpt-x"), 1500)).toBe(true);
    expect(options()).toEqual(["", "gpt-x", "kimi-y"]);
    expect(has("Reading the OpenCode models…")).toBe(false);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("the wait is announced politely, as a status", async () => {
    await openCode([new Promise<Answer>(() => {})]);
    const said = () =>
      screen
        .queryAllByRole("status")
        .some((node) => node.textContent === "Reading the OpenCode models…");
    expect(said()).toBe(true);
  });

  test("a refused read does not mark the Model select invalid, and the message comes before Try again", async () => {
    await openCode([REFUSED]);
    expect(await settleMaybe(() => screen.queryByRole("alert") !== null, 1500)).toBe(true);
    const select = screen.queryByLabelText("Model") as HTMLSelectElement;
    expect(select.getAttribute("aria-invalid")).not.toBe("true");
    const alert = screen.queryByRole("alert") as HTMLElement;
    const retry = screen.queryByRole("button", { name: "Try again" }) as HTMLElement;
    expect((alert.compareDocumentPosition(retry) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(
      true,
    );
  });

  test("after Try again the focus stays in the Model field instead of falling to the page", async () => {
    await openCode([REFUSED, LIST]);
    expect(await settleMaybe(() => screen.queryByRole("alert") !== null, 1500)).toBe(true);
    await press("Try again");
    expect(await settleMaybe(() => options().includes("gpt-x"), 1500)).toBe(true);
    expect(document.activeElement === screen.queryByLabelText("Model")).toBe(true);
  });

  test("in Portuguese the failure and the retry are in Portuguese", async () => {
    await openCode([REFUSED], "pt-BR");
    expect(await settleMaybe(() => screen.queryByRole("alert") !== null, 1500)).toBe(true);
    expect(screen.queryByRole("alert")?.textContent).toContain(
      "Não foi possível ler os modelos do OpenCode",
    );
    expect(screen.queryByRole("button", { name: "Tentar de novo" }) !== null).toBe(true);
  });
});
