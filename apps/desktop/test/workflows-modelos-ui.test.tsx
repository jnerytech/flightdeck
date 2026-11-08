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

type Answer = () => Promise<unknown>;

function setup(
  options: {
    language?: "en" | "pt-BR";
    templates?: Answer;
    fixer?: object;
    copyWorks?: boolean;
  } = {},
) {
  const store = new AppStore(memoryPlatform(false, options.language ?? "en").platform, {
    baseDelayMs: 600_000,
  });
  store.i18n.start();
  const sent: Array<[string, string, unknown]> = [];
  const copied: string[] = [];
  store.hostCommand = (async (hostId: string, type: string, payload: unknown) => {
    sent.push([hostId, type, payload]);
    if (type === "workflow.list") return { workflows: [] };
    if (type === "workflow.templates") {
      return options.templates
        ? options.templates()
        : { templates: [{ ...FIXER, ...options.fixer }, DRAFT] };
    }
    return null;
  }) as never;
  store.copyText = (async (text: string) => {
    copied.push(text);
    return options.copyWorks !== false;
  }) as never;
  render(
    <TContext.Provider value={store.i18n.t}>
      <WorkflowsPage store={store} hostId="h1" projectId="p1" projectName="app" />
    </TContext.Provider>,
  );
  const asked = () => sent.filter(([, type]) => type === "workflow.templates");
  return { store, sent, copied, asked };
}

const click = (el: Element) =>
  act(async () => {
    fireEvent.click(el);
  });
/** Presses the button, or fails the test by assertion when it is not there. */
async function press(name: string) {
  const target = button(name);
  expect(target !== null).toBe(true);
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
    expect(button("Add from a template") !== null).toBe(true);
    expect(asked().length).toBe(0);
    await press("Add from a template");
    await settleMaybe(() => asked().length === 1);
    expect(asked()).toEqual([["h1", "workflow.templates", { projectId: "p1" }]]);
  });

  test("the dialog lists each template with what it does and says nothing is written for you", async () => {
    setup();
    await open();
    await settleMaybe(() => screen.queryByRole("list", { name: "Templates" }) !== null);
    expect(dialog("Workflow templates") !== null).toBe(true);
    const list = screen.queryByRole("list", { name: "Templates" });
    expect(list !== null).toBe(true);
    const items = within(list ?? document.body);
    expect(items.queryByText("Alert fixer") !== null).toBe(true);
    expect(items.queryByText("Fixes one alert on the card's branch.") !== null).toBe(true);
    expect(items.queryByText("Post-mortem draft") !== null).toBe(true);
    expect(screen.queryByText(/Nothing is written for you/) !== null).toBe(true);
  });

  test("while the host answers, the dialog says it is loading", async () => {
    setup({ templates: () => new Promise(() => {}) });
    await open();
    expect(screen.queryByRole("status", { name: "Loading templates" }) !== null).toBe(true);
  });

  test("a host that does not answer says so, and offers no list", async () => {
    setup({ templates: async () => null });
    await open();
    await settleMaybe(() => screen.queryByText(/Could not load the templates/) !== null);
    expect(screen.queryByRole("list", { name: "Templates" }) === null).toBe(true);
    expect(screen.queryByRole("status", { name: "Loading templates" }) === null).toBe(true);
  });

  test("showing a template puts the file, where to commit it and what it asks for in front of you", async () => {
    setup();
    await open("Add from a template", "Show Alert fixer");
    const heading = screen.queryByRole("heading", { name: "Alert fixer" });
    expect(heading !== null).toBe(true);
    expect(document.activeElement === heading).toBe(true);
    expect(screen.queryByText("Persona: dev") !== null).toBe(true);
    expect(screen.queryByText("Asks for: alert") !== null).toBe(true);
    expect(screen.queryByText("Tries the fix up to 3 times.") !== null).toBe(true);
    expect(screen.queryByText("Commit it to .flightdeck/workflows/alert-fixer.yaml") !== null).toBe(
      true,
    );
    const file = screen.queryByRole("region", {
      name: "File .flightdeck/workflows/alert-fixer.yaml",
    });
    expect(file?.textContent).toBe(FIXER.yaml);
    expect(file?.getAttribute("tabindex")).toBe("0");
  });

  test("Copy puts the file on the clipboard and leaves a note saying what to do next", async () => {
    const { copied } = setup();
    await open("Add from a template", "Show Alert fixer");
    expect(screen.queryByText(/^Copied\./) === null).toBe(true);
    await press("Copy the file");
    await settleMaybe(() => screen.queryByText(/^Copied\./) !== null);
    expect(copied).toEqual([FIXER.yaml]);
    expect(
      screen.queryByText("Copied. Commit it to the base branch, then trust it here.") !== null,
    ).toBe(true);
  });

  test("when the copy fails, the note does not say it worked", async () => {
    const { copied } = setup({ copyWorks: false });
    await open("Add from a template", "Show Alert fixer");
    await press("Copy the file");
    await settleMaybe(() => copied.length === 1);
    expect(copied).toEqual([FIXER.yaml]);
    expect(screen.queryByText(/^Copied\./) === null).toBe(true);
  });

  test("Back returns to the list with the focus on the template that was open", async () => {
    setup();
    await open("Add from a template", "Show Alert fixer");
    await press("Back to the templates");
    await settleMaybe(() => screen.queryByRole("list", { name: "Templates" }) !== null);
    const shown = button("Show Alert fixer");
    expect(shown !== null).toBe(true);
    expect(document.activeElement === shown).toBe(true);
  });

  test("the check line says whether it holds the project's test command or a placeholder", async () => {
    setup();
    await open("Add from a template", "Show Alert fixer");
    expect(
      screen.queryByText(
        "The check line holds this project's test command. Review it before you trust the workflow.",
      ) !== null,
    ).toBe(true);
    expect(screen.queryByText(/placeholder that fails/) === null).toBe(true);
  });

  test("a placeholder check line is a warning to fix before the commit", async () => {
    setup({ fixer: { checkFilled: false } });
    await open("Add from a template", "Show Alert fixer");
    expect(
      screen.queryByText(
        "The check line holds a placeholder that fails. Replace it with your test command before you commit the file.",
      ) !== null,
    ).toBe(true);
    expect(screen.queryByText(/holds this project's test command/) === null).toBe(true);
  });

  test("a template with no check line shows neither note", async () => {
    setup();
    await open("Add from a template", "Show Post-mortem draft");
    expect(screen.queryByText(/The check line holds/) === null).toBe(true);
    expect(screen.queryByText("Asks for: incident") !== null).toBe(true);
  });

  test("Escape closes the dialog and the focus goes back to the button that opened it", async () => {
    setup();
    await open();
    await settleMaybe(() => dialog("Workflow templates") !== null);
    const shown = dialog("Workflow templates");
    expect(shown !== null).toBe(true);
    await act(async () => {
      fireEvent.keyDown(shown ?? document.body, { key: "Escape" });
    });
    // The dialog hands the focus back a tick after it unmounts, so wait for the focus itself.
    await settleMaybe(() => document.activeElement === button("Add from a template"));
    expect(dialog("Workflow templates") === null).toBe(true);
    expect(document.activeElement === button("Add from a template")).toBe(true);
  });

  test("in Portuguese the button, the dialog and the template texts follow the language", async () => {
    setup({ language: "pt-BR" });
    await open("Adicionar de um modelo");
    await settleMaybe(() => screen.queryByRole("list", { name: "Modelos" }) !== null);
    expect(dialog("Modelos de workflow") !== null).toBe(true);
    expect(screen.queryByText("Corretor de alertas") !== null).toBe(true);
    await press("Ver Corretor de alertas");
    expect(button("Copiar o arquivo") !== null).toBe(true);
    expect(
      screen.queryByText("Faça commit em .flightdeck/workflows/alert-fixer.yaml") !== null,
    ).toBe(true);
  });
});
