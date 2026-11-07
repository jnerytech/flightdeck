import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen, within, waitFor } = await import(
  "@testing-library/react"
);
const { AppStore } = await import("../src/lib/app-store.ts");
const { ProjectsOverview } = await import("../src/ui/ProjectsOverview.tsx");
const { TooltipProvider } = await import("../src/components/ui/tooltip.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const host = (id: string, name: string, status = "online") => ({
  id,
  name,
  url: "ws://x",
  token: "",
  status,
  info: null,
  hostInfo: { daemonVersion: "x", features: [] },
  latencyMs: null,
  incompatibility: null,
  daemonUpdate: null,
  sessions: [],
});

function setup(
  options: { hosts?: ReturnType<typeof host>[]; scoped?: string; language?: "en" | "pt-BR" } = {},
) {
  const store = new AppStore(memoryPlatform(false, options.language ?? "en").platform, {
    baseDelayMs: 600_000,
  });
  store.i18n.start();
  store.loadPalette = async () => {};
  const sent: Array<[string, string, unknown]> = [];
  store.hostCommand = (async (hostId: string, type: string, payload: unknown) => {
    sent.push([hostId, type, payload]);
    if (type === "project.add") {
      return { id: "p-new", name: "new", path: (payload as { path: string }).path };
    }
    return null;
  }) as never;
  const state = {
    ...store.getState(),
    hosts: options.hosts ?? [host("h1", "alfa"), host("h2", "beta")],
    projects: {},
    externals: {},
    cards: {},
  } as never as ReturnType<InstanceType<typeof AppStore>["getState"]>;
  const added: Array<[string, string]> = [];
  const view = () => (
    <TooltipProvider>
      <ProjectsOverview
        store={store}
        state={state}
        onOpen={() => {}}
        onAdded={(hostId, project) => added.push([hostId, project.id])}
        {...(options.scoped ? { host: options.scoped } : {})}
      />
    </TooltipProvider>
  );
  return { sent, added, view };
}

const button = (name: string) => screen.queryByRole("button", { name });
/** The button, after saying it is there: a miss fails on its expect, not on a missing element. */
const need = (name: string): HTMLElement => {
  const found = button(name);
  expect(found === null).toBe(false);
  return found as HTMLElement;
};
const click = (el: Element) =>
  act(async () => {
    fireEvent.click(el);
  });
const pointer = (el: Element) =>
  act(async () => {
    fireEvent.pointerDown(el, { button: 0, ctrlKey: false, pointerType: "mouse" });
  });
const addFolder = async (folder: string, labels = { folder: "Project folder", add: "Add" }) => {
  const dialog = await screen.findByRole("dialog");
  await act(async () => {
    fireEvent.change(within(dialog).getByLabelText(labels.folder), { target: { value: folder } });
  });
  await click(within(dialog).getByRole("button", { name: labels.add }));
};

// Issue #931: the Projects page had no way to add a project.
describe("projetos-novo-ui: New project on the Projects page", () => {
  test("the button is in the page's header, with the title, where it is always in view", () => {
    const w = setup();
    render(w.view());
    const add = button("New project");
    expect(add === null).toBe(false);
    expect(add?.closest('[data-slot="page-actions"]') === null).toBe(false);
  });

  test("with one host it opens the add form for that host and the project is added there", async () => {
    const w = setup({ hosts: [host("h1", "alfa")] });
    render(w.view());
    await click(need("New project"));
    await addFolder("/work/new");
    await waitFor(() => expect(w.sent.length).toBe(1));
    expect(w.sent).toEqual([["h1", "project.add", { path: "/work/new" }]]);
    await waitFor(() => expect(w.added).toEqual([["h1", "p-new"]]));
  });

  test("with a host filter it opens the form for that host, though more are online", async () => {
    const w = setup({ scoped: "h2" });
    render(w.view());
    await click(need("New project"));
    await addFolder("/work/beta-app");
    await waitFor(() =>
      expect(w.sent).toEqual([["h2", "project.add", { path: "/work/beta-app" }]]),
    );
  });

  test("with all hosts it asks which host first, by name, and then adds there", async () => {
    const w = setup();
    render(w.view());
    await pointer(need("New project"));
    const items = (await screen.findAllByRole("menuitem")).map((item) => item.textContent);
    expect(items).toEqual(["On alfa", "On beta"]);
    await click(screen.getByRole("menuitem", { name: "On beta" }));
    await addFolder("/work/second");
    await waitFor(() => expect(w.sent).toEqual([["h2", "project.add", { path: "/work/second" }]]));
    await waitFor(() => expect(w.added).toEqual([["h2", "p-new"]]));
  });

  test("a host that is not online is not offered, and with none online the button says why it is off", async () => {
    const w = setup({ hosts: [host("h1", "alfa", "offline"), host("h2", "beta")] });
    render(w.view());
    await click(need("New project"));
    await addFolder("/work/only-beta");
    await waitFor(() =>
      expect(w.sent).toEqual([["h2", "project.add", { path: "/work/only-beta" }]]),
    );
    cleanup();
    const none = setup({ hosts: [host("h1", "alfa", "offline")] });
    render(none.view());
    const off = button("New project") as HTMLButtonElement | null;
    expect(off?.disabled).toBe(true);
    expect(document.body.textContent).toContain("No host is online to add a project to.");
  });

  test("it reads in Portuguese too", async () => {
    const w = setup({ language: "pt-BR" });
    render(w.view());
    await pointer(need("Novo projeto"));
    const items = (await screen.findAllByRole("menuitem")).map((item) => item.textContent);
    expect(items).toEqual(["Em alfa", "Em beta"]);
    await click(screen.getByRole("menuitem", { name: "Em alfa" }));
    await addFolder("/work/novo", { folder: "Pasta do projeto", add: "Adicionar" });
    await waitFor(() => expect(w.sent).toEqual([["h1", "project.add", { path: "/work/novo" }]]));
  });
});
