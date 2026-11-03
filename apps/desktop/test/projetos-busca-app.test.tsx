import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { realTempDir } from "../../../scripts/test/temp-dir.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { waiter } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(20_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const settle = waiter(4000);

const initRepo = async (path: string) => {
  mkdirSync(path, { recursive: true });
  await Bun.spawn(["git", "init", "-q", path]).exited;
};

async function projectsPage(language: string, firstRun = true) {
  const d = makeDaemon(cleanups, { firstRun });
  await initRepo(join(d.root, "known"));
  await initRepo(join(d.root, "group", "fresh"));
  const mem = memoryPlatform(false, language);
  const store = new AppStore(mem.platform, { baseDelayMs: 60_000 });
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  const hostId = store.getState().hosts[0]?.id ?? "";
  await act(async () => {
    await store.hostCommand(hostId, "project.add", { path: join(d.root, "known") });
    store.tabs.open({ name: "projects", host: hostId });
  });
  return { d, store, hostId };
}

const eventually = async (check: () => Promise<boolean>) => {
  const end = Date.now() + 4000;
  while (Date.now() < end && !(await check())) await new Promise((r) => setTimeout(r, 25));
  expect(await check()).toBe(true);
};

const projectPaths = async (store: InstanceType<typeof AppStore>, hostId: string) =>
  ((await store.hostCommand(hostId, "project.list", {}))?.projects ?? []).map((p) => p.path).sort();

describe("projetos-busca-app: find my projects", () => {
  test("a host without the finder offers nothing", async () => {
    await projectsPage("pt-BR", false);
    await settle(
      () =>
        screen.queryByLabelText("Projetos") !== null ||
        screen.queryByRole("list", { name: "Projetos" }) !== null,
    );
    expect(screen.queryByRole("button", { name: "Achar meus projetos" })).toBeNull();
  });

  test("the scan lists the repositories that are not projects yet, and adds the ones that are ticked", async () => {
    const { d, store, hostId } = await projectsPage("pt-BR");
    await settle(() => screen.queryByRole("button", { name: "Achar meus projetos" }) !== null);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Achar meus projetos" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Procurar nas pastas permitidas" }));
    });
    const fresh = join(d.root, "group", "fresh");
    await settle(() => screen.queryByRole("list", { name: "Repositórios encontrados" }) !== null);
    const list = screen.getByRole("list", { name: "Repositórios encontrados" });
    // The one that is a project already is not offered again.
    expect(within(list).queryAllByRole("checkbox")).toHaveLength(1);
    const box = within(list).getByRole("checkbox", { name: fresh });
    const add = screen.getByRole("button", { name: "Adicionar selecionados (0)" });
    expect((add as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      fireEvent.click(box);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Adicionar selecionados (1)" }));
    });
    await eventually(async () => (await projectPaths(store, hostId)).includes(fresh));
    expect(await projectPaths(store, hostId)).toEqual([join(d.root, "known"), fresh].sort());
  });

  test("cloning from a URL runs git into the chosen folder and registers the project", async () => {
    const { d, store, hostId } = await projectsPage("pt-BR");
    await settle(() => screen.queryByRole("button", { name: "Achar meus projetos" }) !== null);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Achar meus projetos" }));
    });
    const url = "https://example.com/acme/widget.git";
    fireEvent.change(screen.getByLabelText("Endereço do repositório"), { target: { value: url } });
    expect((screen.getByLabelText("Pasta de destino") as HTMLSelectElement).value).toBe(d.root);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Clonar" }));
    });
    await settle(() => d.gitCalls.length === 1);
    expect(d.gitCalls).toEqual([["clone", "--", url, join(d.root, "widget")]]);
    await eventually(async () =>
      (await projectPaths(store, hostId)).includes(join(d.root, "widget")),
    );
  });

  test("a refused address says why, in the app's language", async () => {
    await projectsPage("en");
    await settle(() => screen.queryByRole("button", { name: "Find my projects" }) !== null);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Find my projects" }));
    });
    fireEvent.change(screen.getByLabelText("Repository address"), {
      target: { value: "file:///etc" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Clone" }));
    });
    await settle(() => screen.queryAllByRole("alert").length === 1);
    expect(screen.getAllByRole("alert")[0]?.textContent).toContain(
      "Only https:// and ssh addresses are cloned.",
    );
  });

  test("unticking a repository takes it off the selection, and Cancel closes the dialog", async () => {
    const { d } = await projectsPage("en");
    await settle(() => screen.queryByRole("button", { name: "Find my projects" }) !== null);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Find my projects" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Scan allowed folders" }));
    });
    const fresh = join(d.root, "group", "fresh");
    await settle(() => screen.queryByRole("checkbox", { name: fresh }) !== null);
    const box = screen.getByRole("checkbox", { name: fresh });
    await act(async () => {
      fireEvent.click(box);
    });
    await settle(() => screen.queryByRole("button", { name: "Add selected (1)" }) !== null);
    await act(async () => {
      fireEvent.click(box);
    });
    await settle(() => screen.queryByRole("button", { name: "Add selected (0)" }) !== null);
    expect(
      (screen.getByRole("button", { name: "Add selected (0)" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });
    await settle(() => screen.queryByRole("checkbox", { name: fresh }) === null);
    // Escape closes it too (the dialog's own close path).
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Find my projects" }));
    });
    await settle(() => screen.queryByRole("button", { name: "Cancel" }) !== null);
    await act(async () => {
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    });
    await settle(() => screen.queryByRole("dialog") === null);
  });

  test("a folder name typed by the person is the one git clones into", async () => {
    const { d } = await projectsPage("en");
    await settle(() => screen.queryByRole("button", { name: "Find my projects" }) !== null);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Find my projects" }));
    });
    const url = "https://example.com/acme/widget.git";
    fireEvent.change(screen.getByLabelText("Repository address"), { target: { value: url } });
    fireEvent.change(screen.getByLabelText("Folder name (optional)"), {
      target: { value: "custom" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Clone" }));
    });
    await settle(() => d.gitCalls.length === 1);
    expect(d.gitCalls).toEqual([["clone", "--", url, join(d.root, "custom")]]);
  });

  test("the destination folder picked from the host's allowed folders is where git clones", async () => {
    const { d, store, hostId } = await projectsPage("en");
    const other = realTempDir("fd-other-");
    await act(async () => {
      expect(await store.allowRoot(hostId, other)).toBe(true);
    });
    await settle(() => screen.queryByRole("button", { name: "Find my projects" }) !== null);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Find my projects" }));
    });
    const select = screen.getByLabelText("Destination folder") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual([d.root, other]);
    fireEvent.change(select, { target: { value: other } });
    const url = "https://example.com/acme/widget.git";
    fireEvent.change(screen.getByLabelText("Repository address"), { target: { value: url } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Clone" }));
    });
    await settle(() => d.gitCalls.length === 1);
    expect(d.gitCalls).toEqual([["clone", "--", url, join(other, "widget")]]);
  });
});
