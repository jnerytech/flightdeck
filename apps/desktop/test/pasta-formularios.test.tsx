import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { liveScreen, registerDom } from "./dom.ts";
import type { HostView } from "../src/lib/app-store.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";

registerDom();
const {
  act,
  cleanup,
  fireEvent,
  render,
  within,
  waitFor: rtlWaitFor,
} = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const waitFor = <T,>(fn: () => T) => rtlWaitFor(fn, { timeout: 3000 });

async function setup() {
  const d = makeDaemon(cleanups);
  mkdirSync(join(d.root, "alfa", "interna"), { recursive: true });
  const store = new AppStore(memoryPlatform(false, "pt-BR").platform, {
    baseDelayMs: 10,
    maxDelayMs: 20,
  });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  const hostId = await act(() => store.addHost({ name: "pc", url: d.listen().url, token: TOKEN }));
  await waitFor(() => expect(store.getState().hosts[0]?.hostInfo !== null).toBe(true));
  return { ...d, store, hostId };
}

const dialog = () => screen.queryByRole("dialog", { name: "Escolher pasta" });
const inDialog = (name: string | RegExp) =>
  within(dialog() as HTMLElement).queryByRole("button", { name });
const shown = (name: string | RegExp) => inDialog(name) !== null;
async function pressInDialog(name: string | RegExp) {
  await waitFor(() => expect(shown(name)).toBe(true));
  await act(async () => {
    fireEvent.click(inDialog(name) as HTMLElement);
  });
}
/** Browses to `<root>/alfa` and chooses it. */
async function chooseAlfa(root: string) {
  await waitFor(() => expect(dialog() !== null).toBe(true));
  await pressInDialog(new RegExp(`^${root.split("/").at(-1)}`));
  await pressInDialog("alfa");
  await waitFor(() => expect(shown("interna")).toBe(true));
  await pressInDialog("Escolher esta pasta");
}

describe("pasta: o seletor nos formulários", () => {
  test("Nova sessão: Procurar… fills the folder and the subfolder, and the session starts there", async () => {
    const { store, hostId, root, manager } = await setup();
    await act(async () => {
      store.router.push({ name: "new-session", host: hostId });
    });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Procurar…" }) !== null).toBe(true),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Procurar…" }));
    });
    await chooseAlfa(root);
    await waitFor(() => expect(dialog() === null).toBe(true));
    expect((screen.getByLabelText("Subpasta") as HTMLInputElement).value).toBe("alfa");
    fireEvent.change(screen.getByLabelText("Primeiro prompt"), { target: { value: "oi" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Criar sessão" }));
    });
    await waitFor(() => expect(manager.list()[0]?.cwd).toBe(join(root, "alfa")));
  });

  test("Nova sessão: typing the subfolder still works", async () => {
    const { store, hostId, root, manager } = await setup();
    await act(async () => {
      store.router.push({ name: "new-session", host: hostId });
    });
    await waitFor(() => expect(screen.queryByLabelText("Subpasta") !== null).toBe(true));
    fireEvent.change(screen.getByLabelText("Subpasta"), { target: { value: "alfa" } });
    fireEvent.change(screen.getByLabelText("Primeiro prompt"), { target: { value: "oi" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Criar sessão" }));
    });
    await waitFor(() => expect(manager.list()[0]?.cwd).toBe(join(root, "alfa")));
  });

  test("Projetos: Procurar… fills the repository path", async () => {
    const { store, hostId, root } = await setup();
    await act(async () => {
      store.router.push({ name: "projects", host: hostId });
    });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Procurar…" }) !== null).toBe(true),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Procurar…" }));
    });
    await chooseAlfa(root);
    await waitFor(() =>
      expect((screen.getByLabelText("Caminho do repositório") as HTMLInputElement).value).toBe(
        join(root, "alfa"),
      ),
    );
  });

  /** Changes what the app knows about its host, as a daemon of another kind would have said. */
  const rewrite = async (
    store: InstanceType<typeof AppStore>,
    hostId: string,
    change: (host: HostView) => Partial<HostView>,
  ) => {
    const hosts = store.getState().hosts.map((h) => (h.id === hostId ? { ...h, ...change(h) } : h));
    await act(async () => {
      (store as unknown as { update(patch: object): void }).update({ hosts });
    });
  };

  test("a host that does not announce fs.dirs gets no Procurar… button", async () => {
    const { store, hostId } = await setup();
    await rewrite(store, hostId, (h) => ({
      hostInfo: { ...(h.hostInfo as object), features: [] } as unknown as HostView["hostInfo"],
    }));
    await act(async () => {
      store.router.push({ name: "new-session", host: hostId });
    });
    await waitFor(() => expect(screen.queryByLabelText("Subpasta") !== null).toBe(true));
    expect(screen.queryByRole("button", { name: "Procurar…" }) === null).toBe(true);
  });

  test("Nova sessão: a folder the host resolved outside its configured roots becomes a root of its own", async () => {
    const { store, hostId, root, manager } = await setup();
    // The configured root is a name the host's real folders do not start with (a link, say).
    await rewrite(store, hostId, (h) => ({
      info: {
        ...(h.info as object),
        allowedRoots: ["/somewhere/else"],
      } as unknown as HostView["info"],
    }));
    await act(async () => {
      store.router.push({ name: "new-session", host: hostId });
    });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Procurar…" }) !== null).toBe(true),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Procurar…" }));
    });
    await chooseAlfa(root);
    await waitFor(() => expect(dialog() === null).toBe(true));
    expect((screen.getByLabelText("Pasta") as HTMLSelectElement).value).toBe(join(root, "alfa"));
    expect((screen.getByLabelText("Subpasta") as HTMLInputElement).value).toBe("");
    fireEvent.change(screen.getByLabelText("Primeiro prompt"), { target: { value: "oi" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Criar sessão" }));
    });
    await waitFor(() => expect(manager.list()[0]?.cwd).toBe(join(root, "alfa")));
  });

  test("Cancelar closes the picker of Nova sessão and of Projetos without changing the form", async () => {
    const { store, hostId } = await setup();
    for (const route of [
      { name: "new-session", host: hostId },
      { name: "projects", host: hostId },
    ] as const) {
      await act(async () => {
        store.router.push(route);
      });
      await waitFor(() =>
        expect(screen.queryByRole("button", { name: "Procurar…" }) !== null).toBe(true),
      );
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Procurar…" }));
      });
      await pressInDialog("Cancelar");
      await waitFor(() => expect(dialog() === null).toBe(true));
    }
  });
});
