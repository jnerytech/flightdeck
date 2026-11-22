import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { RequestError } from "../../src/features/hosts/host-connection.ts";
import { liveScreen, registerDom } from "../dom.ts";
import { interceptWire } from "../fake-host.ts";
import { memoryPlatform } from "../fixtures.ts";
import { settle } from "../wait.ts";
import { snippetsHost } from "./ui-setup.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { App } = await import("../../src/app/App.tsx");

setDefaultTimeout(30_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

type Intercept = (type: string, payload: unknown, next: () => Promise<unknown>) => Promise<unknown>;
const never = () => new Promise<never>(() => {});

/** The Snippets screen over a real daemon with `eco` and `status`; the wire goes through `hooks.intercept`, which can be swapped. */
async function open(language: "en" | "pt-BR") {
  const store = new AppStore(memoryPlatform(false, language).platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const h = await snippetsHost(cleanups, store);
  for (const name of ["eco", "status"]) {
    await h.save({ name, type: "command", run: `echo ${name}` });
  }
  const hooks: { intercept: Intercept } = { intercept: (_type, _payload, next) => next() };
  render(<App store={store} />);
  await settle(() => screen.queryByRole("button", { name: "Snippets" }) !== null);
  // The app starts its own connection to the host: break the wire of the one it keeps.
  await settle(() => store.getState().hosts[0]?.status === "online");
  interceptWire(store, h.hostId, (type, payload, next) => hooks.intercept(type, payload, next));
  await act(async () => {
    fireEvent.click(screen.queryByRole("button", { name: "Snippets" }) as HTMLElement);
  });
  await settle(() => rowNames().length === 2);
  return { store, hooks, ...h };
}

const rowNames = () => {
  const list = screen.queryByRole("list", { name: "Snippets" });
  return list
    ? within(list)
        .queryAllByRole("listitem")
        .map((r) => r.querySelector("[data-name]")?.textContent ?? "")
    : [];
};
const button = (name: string) => screen.queryByRole("button", { name }) as HTMLButtonElement | null;
const press = async (name: string) => {
  const target = button(name);
  expect(target).not.toBeNull();
  await act(async () => {
    fireEvent.click(target as HTMLElement);
  });
};
/** Lets the page take in what it was just answered, so a check on its screen looks at the settled one. */
const afterAnswer = () =>
  act(async () => {
    await Bun.sleep(80);
  });
const choose = async (label: string, value: string) => {
  await act(async () => {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  });
};
const refuse = (type: string): Intercept => {
  return (wire, _payload, next) =>
    wire === type ? Promise.reject(new RequestError("bad_thing", "No room left")) : next();
};
const YAML =
  "- name: testes\n  type: command\n  run: bun test\n- name: revisar\n  type: prompt\n  text: Revise isto.\n";
/** Picks the YAML file in the import panel. */
const chooseFile = async (label: string, text: string) => {
  await act(async () => {
    fireEvent.change(screen.getByLabelText(label), {
      target: { files: [new File([text], "snippets.yaml", { type: "text/yaml" })] },
    });
  });
};

const WORDS = {
  en: {
    favorite: "Favorite eco",
    remove: "Remove",
    removeFor: "Remove eco",
    search: "Search snippet",
    project: "Project",
    trust: "Trust the file",
    openFile: "Import from a file",
    choose: "Snippets file (YAML or JSON)",
    found: "Snippets in the file",
    importFile: "Import from the file",
  },
  "pt-BR": {
    favorite: "Favoritar eco",
    remove: "Remover",
    removeFor: "Remover eco",
    search: "Buscar snippet",
    project: "Projeto",
    trust: "Confiar no arquivo",
    openFile: "Importar de arquivo",
    choose: "Arquivo de snippets (YAML ou JSON)",
    found: "Snippets do arquivo",
    importFile: "Importar do arquivo",
  },
} as const;

// Issue #3970: Favorite, Remove, Trust file and Import from the file are busy until the host answers (a
// second press sends nothing), a confirmed Remove leaves the focus on a control that stays, and a file
// that cannot be read says why in the import panel.
describe.each(["en", "pt-BR"] as const)("snippets-ui: busy actions (%s)", (language) => {
  const w = WORDS[language];

  test("Favorite is busy until the host answers and a second press sends nothing", async () => {
    const d = await open(language);
    let sent = 0;
    d.hooks.intercept = (type, _payload, next) => {
      if (type !== "snippets.favorite") return next();
      sent++;
      return never();
    };
    await press(w.favorite);
    await settle(() => sent === 1);
    await afterAnswer();
    expect(button(w.favorite)?.getAttribute("aria-busy")).toBe("true");
    await press(w.favorite);
    await afterAnswer();
    expect(sent).toBe(1);
  });

  test("a confirmed Remove leaves the row's Remove busy and sends once", async () => {
    const d = await open(language);
    let sent = 0;
    d.hooks.intercept = (type, _payload, next) => {
      if (type !== "snippets.remove") return next();
      sent++;
      return never();
    };
    await press(w.removeFor);
    await press(w.remove);
    await settle(() => sent === 1);
    await afterAnswer();
    expect(button(w.removeFor)?.getAttribute("aria-busy")).toBe("true");
    await press(w.removeFor);
    await afterAnswer();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(sent).toBe(1);
  });

  test("a confirmed Remove leaves the focus on the search field, which stays", async () => {
    await open(language);
    await press(w.removeFor);
    await press(w.remove);
    await settle(() => rowNames().join() === "status");
    await afterAnswer();
    expect(document.activeElement === screen.getByLabelText(w.search)).toBe(true);
  });

  test("Trust the file is busy while the signing waits and a second press asks nothing more", async () => {
    const d = await open(language);
    d.writeFile('- name: testes\n  type: command\n  run: "bun test"\n');
    await choose(w.project, d.repo);
    await settle(() => button(w.trust) !== null);
    let asked = 0;
    d.store.approval.snippetTrustPayload = () => {
      asked++;
      return never();
    };
    await press(w.trust);
    await settle(() => asked === 1);
    await afterAnswer();
    expect(button(w.trust)?.getAttribute("aria-busy")).toBe("true");
    await press(w.trust);
    await afterAnswer();
    expect(asked).toBe(1);
  });

  test("Import from the file is busy while it saves and a second press saves nothing more", async () => {
    const d = await open(language);
    await press(w.openFile);
    await chooseFile(w.choose, YAML);
    await settle(() => screen.queryByRole("list", { name: w.found }) !== null);
    let saved = 0;
    d.hooks.intercept = (type, _payload, next) => {
      if (type !== "snippets.save") return next();
      saved++;
      return never();
    };
    await press(w.importFile);
    await settle(() => saved === 1);
    await afterAnswer();
    expect(button(w.importFile)?.getAttribute("aria-busy")).toBe("true");
    await press(w.importFile);
    await afterAnswer();
    expect(saved).toBe(1);
  });

  test("a file the host cannot read says why in the import panel", async () => {
    const d = await open(language);
    await press(w.openFile);
    d.hooks.intercept = refuse("snippets.parse");
    await chooseFile(w.choose, YAML);
    await afterAnswer();
    // The panel is the file field's parent's parent: the banner outside it says the same words.
    const panel = screen.getByLabelText(w.choose).parentElement?.parentElement as HTMLElement;
    expect(panel.textContent).toContain("No room left");
  });
});
