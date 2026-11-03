import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
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
});
