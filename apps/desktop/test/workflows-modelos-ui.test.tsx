import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settleMaybe } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { TContext } = await import("../src/i18n/context.tsx");
const { WorkflowsPage } = await import("../src/ui/WorkflowsPage.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const FIXER = {
  id: "alert-fixer",
  title: { en: "Alert fixer", "pt-BR": "Corretor de alertas" },
  description: {
    en: "Fixes one alert on the card's branch.",
    "pt-BR": "Corrige um alerta na branch do card.",
  },
  limits: { en: "Tries the fix up to 3 times.", "pt-BR": "Tenta a correção até 3 vezes." },
  persona: "dev",
  inputs: ["alert"],
  path: ".flightdeck/workflows/alert-fixer.yaml",
  yaml: "name: Alert fixer\ninputs: [alert]\n",
  checkFilled: true,
};
const DRAFT = {
  id: "post-mortem",
  title: { en: "Post-mortem draft", "pt-BR": "Rascunho de post-mortem" },
  description: {
    en: "Drafts a post-mortem of an incident.",
    "pt-BR": "Redige o post-mortem de um incidente.",
  },
  limits: { en: "Writes one file.", "pt-BR": "Escreve um arquivo." },
  persona: "sre",
  inputs: ["incident"],
  path: ".flightdeck/workflows/post-mortem.yaml",
  yaml: "name: Post-mortem draft\ninputs: [incident]\n",
  checkFilled: null,
};

const ADDED = {
  path: ".flightdeck/workflows/alert-fixer.yaml",
  branch: "flightdeck/workflow-alert-fixer-20261108-1405",
  base: "main",
  url: "https://github.com/o/r/pull/7",
};
const OFFERED = ["workflowTemplateAdd"];

type Answer = () => Promise<unknown>;

function setup(
  options: {
    language?: "en" | "pt-BR";
    templates?: Answer;
    fixer?: object;
    copyWorks?: boolean;
    /** Answers the next copies by hand: each call waits for its resolver. */
    copyBy?: Array<(worked: boolean) => void>;
    /** The host's features (#1221); without them the store knows no host, as before. */
    features?: string[];
    /** The answer to `workflow.template.add`; null is a refusal the store already showed. */
    added?: object | null;
    /** Answers the next adds by hand: each call waits for its resolver. */
    addBy?: Array<(answer: object | null) => void>;
  } = {},
) {
  const store = new AppStore(memoryPlatform(false, options.language ?? "en").platform, {
    baseDelayMs: 600_000,
  });
  store.i18n.start();
  if (options.features) {
    (store as unknown as { update(p: object): void }).update({
      hosts: [
        {
          id: "h1",
          name: "alfa",
          url: "ws://x",
          token: "",
          status: "online",
          info: null,
          hostInfo: { daemonVersion: "x", features: options.features },
          incompatibility: null,
          daemonUpdate: null,
          sessions: [],
        },
      ],
    });
  }
  const sent: Array<[string, string, unknown]> = [];
  const copied: string[] = [];
  const opened: string[] = [];
  store.openLink = ((url: string) => void opened.push(url)) as never;
  store.hostCommand = (async (hostId: string, type: string, payload: unknown) => {
    sent.push([hostId, type, payload]);
    if (type === "workflow.list") return { workflows: [] };
    if (type === "workflow.template.add") {
      const by = options.addBy;
      if (by) return new Promise((resolve) => by.push(resolve));
      return options.added === undefined ? ADDED : options.added;
    }
    if (type === "workflow.templates") {
      return options.templates
        ? options.templates()
        : { templates: [{ ...FIXER, ...options.fixer }, DRAFT] };
    }
    return null;
  }) as never;
  store.copyText = (async (text: string) => {
    copied.push(text);
    const by = options.copyBy;
    if (by) return new Promise<boolean>((resolve) => by.push(resolve));
    return options.copyWorks !== false;
  }) as never;
  render(
    <TContext.Provider value={store.i18n.t}>
      <WorkflowsPage store={store} hostId="h1" projectId="p1" projectName="app" />
    </TContext.Provider>,
  );
  const asked = () => sent.filter(([, type]) => type === "workflow.templates");
  const adds = () => sent.filter(([, type]) => type === "workflow.template.add");
  return { store, sent, copied, asked, adds, opened };
}

const click = (el: Element) =>
  act(async () => {
    fireEvent.click(el);
  });
/** Presses the button, or fails the test by assertion when it is not there. */
async function press(name: string) {
  const target = button(name);
  expect(target).not.toBeNull();
  if (target) await click(target);
}
const button = (name: string) => screen.queryByRole("button", { name });
const dialog = (name: string) => screen.queryByRole("dialog", { name });
const loaded = () =>
  settleMaybe(
    () =>
      screen.queryByText("No workflows on the base branch yet.") !== null ||
      screen.queryByText("Nenhum workflow na branch base ainda.") !== null,
  );

/** Opens the dialog and, when a name is given, the detail of that template. */
async function open(opener = "Add from a template", show?: string) {
  await loaded();
  await press(opener);
  if (show) {
    await settleMaybe(() => button(show) !== null);
    await press(show);
  }
}

describe("workflow templates on the Workflows screen (issue #79)", () => {
  test("the page offers Add from a template, and asks the host only when it is opened", async () => {
    const { asked } = setup();
    await loaded();
    expect(button("Add from a template")).not.toBeNull();
    expect(asked()).toHaveLength(0);
    await press("Add from a template");
    await settleMaybe(() => asked().length === 1);
    expect(asked()).toEqual([["h1", "workflow.templates", { projectId: "p1" }]]);
  });

  test("the dialog lists each template with what it does and says nothing is written for you", async () => {
    setup();
    await open();
    await settleMaybe(() => screen.queryByRole("list", { name: "Templates" }) !== null);
    expect(dialog("Workflow templates")).not.toBeNull();
    const list = screen.queryByRole("list", { name: "Templates" });
    expect(list).not.toBeNull();
    const items = within(list ?? document.body);
    expect(items.queryByText("Alert fixer")).not.toBeNull();
    expect(items.queryByText("Fixes one alert on the card's branch.")).not.toBeNull();
    expect(items.queryByText("Post-mortem draft")).not.toBeNull();
    expect(screen.queryByText(/Nothing is written for you/)).not.toBeNull();
  });

  test("while the host answers, the dialog says it is loading", async () => {
    setup({ templates: () => new Promise(() => {}) });
    await open();
    expect(screen.queryByRole("status", { name: "Loading templates" })).not.toBeNull();
  });

  test("a host that does not answer says so, and offers no list", async () => {
    setup({ templates: async () => null });
    await open();
    await settleMaybe(() => screen.queryByText(/Could not load the templates/) !== null);
    expect(screen.queryByRole("list", { name: "Templates" }) === null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    expect(screen.queryByRole("status", { name: "Loading templates" }) === null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
  });

  test("showing a template puts the file, where to commit it and what it asks for in front of you", async () => {
    setup();
    await open("Add from a template", "Show Alert fixer");
    const heading = screen.queryByRole("heading", { name: "Alert fixer" });
    expect(heading).not.toBeNull();
    expect(document.activeElement === heading).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    expect(screen.queryByText("Persona: dev")).not.toBeNull();
    expect(screen.queryByText("Asks for: alert")).not.toBeNull();
    expect(screen.queryByText("Tries the fix up to 3 times.")).not.toBeNull();
    expect(
      screen.queryByText("Commit it to .flightdeck/workflows/alert-fixer.yaml"),
    ).not.toBeNull();
    const file = screen.queryByRole("region", {
      name: "File .flightdeck/workflows/alert-fixer.yaml",
    });
    expect(file?.textContent).toBe(FIXER.yaml);
    expect(file?.getAttribute("tabindex")).toBe("0");
  });

  test("Copy puts the file on the clipboard and leaves a note saying what to do next", async () => {
    const { copied } = setup();
    await open("Add from a template", "Show Alert fixer");
    expect(screen.queryByText(/^Copied\./) === null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    await press("Copy the file");
    await settleMaybe(() => screen.queryByText(/^Copied\./) !== null);
    expect(copied).toEqual([FIXER.yaml]);
    expect(
      screen.queryByText("Copied. Commit it to the base branch, then trust it here."),
    ).not.toBeNull();
  });

  test("when the copy fails, the note does not say it worked", async () => {
    const { copied } = setup({ copyWorks: false });
    await open("Add from a template", "Show Alert fixer");
    await press("Copy the file");
    await settleMaybe(() => copied.length === 1);
    expect(copied).toEqual([FIXER.yaml]);
    expect(screen.queryByText(/^Copied\./) === null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
  });

  test("when the copy fails, an alert says the clipboard refused and to copy the text by hand", async () => {
    setup({ copyWorks: false });
    await open("Add from a template", "Show Alert fixer");
    await press("Copy the file");
    const said = await settleMaybe(() =>
      Boolean(
        screen
          .queryByRole("alert")
          ?.textContent?.includes(
            "The clipboard refused the copy. Select the file's text above and copy it by hand.",
          ),
      ),
    );
    expect(said).toBe(true);
  });

  test("Copied is announced by a region that stays in the page, and said again for each copy", async () => {
    const pending: Array<(worked: boolean) => void> = [];
    setup({ copyBy: pending });
    await open("Add from a template", "Show Alert fixer");
    const region = () => document.querySelector("[data-slot='copy-status']");
    // The live region is there before anything is copied, empty: text put into a region that was
    // just inserted is often not read.
    expect(region()?.getAttribute("role")).toBe("status");
    expect(region()?.textContent).toBe("");
    await press("Copy the file");
    await settleMaybe(() => pending.length === 1);
    await act(async () => pending[0]?.(true));
    expect(await settleMaybe(() => Boolean(region()?.textContent?.startsWith("Copied.")))).toBe(
      true,
    );
    // A second copy empties the region first and fills it when it works, so it is read again.
    await press("Copy the file");
    await settleMaybe(() => pending.length === 2);
    expect(region()?.textContent).toBe("");
    await act(async () => pending[1]?.(true));
    expect(await settleMaybe(() => Boolean(region()?.textContent?.startsWith("Copied.")))).toBe(
      true,
    );
  });

  test("a host with no templates says so instead of showing an empty list", async () => {
    setup({ templates: async () => ({ templates: [] }) });
    await open();
    const said = await settleMaybe(
      () => screen.queryByText("This host offers no templates.") !== null,
    );
    expect(said).toBe(true);
    expect(screen.queryByRole("list", { name: "Templates" }) === null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
  });

  test("Back returns to the list with the focus on the template that was open", async () => {
    setup();
    await open("Add from a template", "Show Alert fixer");
    await press("Back to the templates");
    await settleMaybe(() => screen.queryByRole("list", { name: "Templates" }) !== null);
    const shown = button("Show Alert fixer");
    expect(shown).not.toBeNull();
    expect(document.activeElement === shown).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
  });

  test("the check line says whether it holds the project's test command or a placeholder", async () => {
    setup();
    await open("Add from a template", "Show Alert fixer");
    expect(
      screen.queryByText(
        "The check line holds this project's test command. Review it before you trust the workflow.",
      ),
    ).not.toBeNull();
    expect(screen.queryByText(/placeholder that fails/) === null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
  });

  test("a placeholder check line is a warning to fix before the commit", async () => {
    setup({ fixer: { checkFilled: false } });
    await open("Add from a template", "Show Alert fixer");
    expect(
      screen.queryByText(
        "The check line holds a placeholder that fails. Replace it with your test command before you commit the file.",
      ),
    ).not.toBeNull();
    expect(screen.queryByText(/holds this project's test command/) === null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
  });

  test("a template with no check line shows neither note", async () => {
    setup();
    await open("Add from a template", "Show Post-mortem draft");
    expect(screen.queryByText(/The check line holds/) === null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    expect(screen.queryByText("Asks for: incident")).not.toBeNull();
  });

  test("Escape closes the dialog and the focus goes back to the button that opened it", async () => {
    setup();
    await open();
    await settleMaybe(() => dialog("Workflow templates") !== null);
    const shown = dialog("Workflow templates");
    expect(shown).not.toBeNull();
    await act(async () => {
      fireEvent.keyDown(shown ?? document.body, { key: "Escape" });
    });
    // The dialog hands the focus back a tick after it unmounts, so wait for the focus itself.
    await settleMaybe(() => document.activeElement === button("Add from a template"));
    expect(dialog("Workflow templates") === null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    expect(document.activeElement === button("Add from a template")).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
  });

  test("in Portuguese the refused copy and the empty list are said in Portuguese", async () => {
    setup({ language: "pt-BR", copyWorks: false });
    await open("Adicionar de um modelo", "Ver Corretor de alertas");
    await press("Copiar o arquivo");
    const said = await settleMaybe(() =>
      Boolean(screen.queryByRole("alert")?.textContent?.includes("recusou a cópia")),
    );
    expect(said).toBe(true);
    cleanup();
    setup({ language: "pt-BR", templates: async () => ({ templates: [] }) });
    await open("Adicionar de um modelo");
    expect(
      await settleMaybe(() => screen.queryByText("Este host não oferece modelos.") !== null),
    ).toBe(true);
  });

  test("in Portuguese the button, the dialog and the template texts follow the language", async () => {
    setup({ language: "pt-BR" });
    await open("Adicionar de um modelo");
    await settleMaybe(() => screen.queryByRole("list", { name: "Modelos" }) !== null);
    expect(dialog("Modelos de workflow")).not.toBeNull();
    // #1051: says the app writes no file, not that "nothing is saved for you".
    expect(screen.queryByText(/O app não grava nenhum arquivo por você\.$/)).not.toBeNull();
    expect(screen.queryByText("Corretor de alertas")).not.toBeNull();
    await press("Ver Corretor de alertas");
    expect(button("Copiar o arquivo")).not.toBeNull();
    expect(
      screen.queryByText("Faça commit em .flightdeck/workflows/alert-fixer.yaml"),
    ).not.toBeNull();
  });
});

describe("adding a template to the project from the app (issue #1221)", () => {
  test("Add to the project asks first, then has the host open the PR, and links it", async () => {
    const { adds, opened } = setup({ features: OFFERED });
    await open("Add from a template", "Show Alert fixer");
    await press("Add to the project");
    expect(adds()).toHaveLength(0);
    const asking = screen.queryByRole("group", { name: "Add Alert fixer to the project" });
    expect(asking).not.toBeNull();
    expect(
      within(asking ?? document.body).queryByText(
        /\.flightdeck\/workflows\/alert-fixer\.yaml on a new branch/,
      ),
    ).not.toBeNull();
    await press("Open the pull request");
    await settleMaybe(() => button("View the pull request") !== null);
    expect(adds()).toEqual([
      [
        "h1",
        "workflow.template.add",
        { projectId: "p1", templateId: "alert-fixer", confirm: true },
      ],
    ]);
    const status = document.querySelector('[data-slot="add-status"]');
    expect(status?.getAttribute("role") ?? "").toBe("status");
    expect(status?.textContent ?? "").toContain(ADDED.branch);
    expect(document.activeElement === button("View the pull request")).toBe(true);
    await press("View the pull request");
    expect(opened).toEqual([ADDED.url]);
  });

  test("the answer is described by the question, and keeps the focus while the host works", async () => {
    const addBy: Array<(answer: object | null) => void> = [];
    const { adds } = setup({ features: OFFERED, addBy });
    await open("Add from a template", "Show Alert fixer");
    await press("Add to the project");
    const go = button("Open the pull request");
    const described = document.getElementById(go?.getAttribute("aria-describedby") ?? "");
    expect(described?.textContent ?? "").toContain(".flightdeck/workflows/alert-fixer.yaml");
    await press("Open the pull request");
    const busy = button("Opening the pull request…");
    expect([busy?.getAttribute("aria-disabled") ?? "", document.activeElement === busy]).toEqual([
      "true",
      true,
    ]);
    await press("Opening the pull request…");
    expect(adds()).toHaveLength(1);
    await act(async () => addBy[0]?.(ADDED));
    await settleMaybe(() => button("View the pull request") !== null);
    expect(button("View the pull request")).not.toBeNull();
  });

  test("Cancel sends nothing and gives the focus back to Add to the project", async () => {
    const { adds } = setup({ features: OFFERED });
    await open("Add from a template", "Show Alert fixer");
    await press("Add to the project");
    await press("Cancel");
    expect(adds()).toHaveLength(0);
    expect(screen.queryByRole("group", { name: "Add Alert fixer to the project" }) === null).toBe(
      true,
    );
    expect(document.activeElement === button("Add to the project")).toBe(true);
  });

  test("a refusal leaves no note that it worked and offers Add to the project again", async () => {
    setup({ features: OFFERED, added: null });
    await open("Add from a template", "Show Alert fixer");
    await press("Add to the project");
    await press("Open the pull request");
    await settleMaybe(() => button("Add to the project") !== null);
    expect(button("Add to the project")).not.toBeNull();
    expect(button("View the pull request") === null).toBe(true);
  });

  test("a host that does not offer it keeps the copy path and its words", async () => {
    setup({ features: [] });
    await open("Add from a template", "Show Alert fixer");
    expect(button("Copy the file")).not.toBeNull();
    expect(button("Add to the project") === null).toBe(true);
    expect(screen.queryByText(/Nothing is written for you/)).not.toBeNull();
  });

  test("in Portuguese the add, its question and its note follow the language", async () => {
    setup({ features: OFFERED, language: "pt-BR" });
    await open("Adicionar de um modelo", "Ver Corretor de alertas");
    await press("Adicionar ao projeto");
    expect(
      screen.queryByRole("group", { name: "Adicionar Corretor de alertas ao projeto" }),
    ).not.toBeNull();
    await press("Abrir o pull request");
    await settleMaybe(() => button("Ver o pull request") !== null);
    expect(button("Ver o pull request")).not.toBeNull();
  });
});
