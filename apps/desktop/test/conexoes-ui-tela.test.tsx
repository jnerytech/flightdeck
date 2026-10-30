import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { sshDaemon, sshTarget } from "./ssh-daemon.ts";

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

async function settle(check: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await act(() => Bun.sleep(10));
}

const TARGETS = [
  sshTarget({ id: "t1", name: "vps", host: "vps.example.com", tags: ["prod"] }),
  sshTarget({
    id: "t2",
    name: "staging",
    host: "stg.example.com",
    user: "ci",
    port: 2222,
    tags: ["staging", "cliente X"],
  }),
  sshTarget({ id: "t3", name: "lab", host: "lab.local", viaHost: "outro", tags: [] }),
];

/** The app over a phase 15 daemon, on the Conexões screen. */
async function open(options: Parameters<typeof sshDaemon>[1] = { targets: TARGETS }) {
  const d = sshDaemon(cleanups, options);
  const store = new AppStore(memoryPlatform(false, "pt-BR").platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const hostId = await store.addHost({ name: "pc", url: d.url, token: TOKEN });
  await settle(() => store.getState().hosts.every((h) => h.status === "online"));
  await settle(() => d.commands.some((c) => c.type === "host.info"));
  render(<App store={store} />);
  const nav = screen.queryByRole("button", { name: "Conexões" });
  expect(nav).not.toBeNull();
  await act(async () => {
    fireEvent.click(nav as HTMLElement);
  });
  await settle(() => d.commands.some((c) => c.type === "ssh.list"));
  await act(() => Bun.sleep(20));
  return { d, store, hostId };
}

const rows = () => {
  const list = screen.queryByRole("list", { name: "Destinos" });
  return list ? within(list).queryAllByRole("listitem") : [];
};

describe("conexoes-ui: the screen", () => {
  test("the sidebar's Conexões item opens the screen for a host that announces ssh", async () => {
    await open();
    expect(screen.queryByRole("heading", { name: "Conexões", level: 1 })).not.toBeNull();
  });

  test("a host without the ssh feature shows no Conexões item", async () => {
    const d = sshDaemon(cleanups, { feature: false });
    const store = new AppStore(memoryPlatform(false, "pt-BR").platform, { baseDelayMs: 60_000 });
    cleanups.push(() => store.dispose());
    await store.addHost({ name: "pc", url: d.url, token: TOKEN });
    await settle(() => store.getState().hosts.every((h) => h.status === "online"));
    await settle(() => d.commands.some((c) => c.type === "host.info"));
    render(<App store={store} />);
    await act(() => Bun.sleep(30));
    expect(screen.queryByRole("button", { name: "Conexões" })).toBeNull();
  });

  test("each destino shows its name, user@host:port and tags, with Conectar, Editar, Duplicar and Remover", async () => {
    await open();
    expect(rows()).toHaveLength(3);
    const staging = within(rows()[1] as HTMLElement);
    expect(staging.queryByText("staging")).not.toBeNull();
    expect(staging.queryByText("ci@stg.example.com:2222")).not.toBeNull();
    expect(staging.queryByText("cliente X")).not.toBeNull();
    for (const verb of ["Conectar", "Editar", "Duplicar", "Remover"]) {
      expect(staging.queryByRole("button", { name: `${verb} staging` })).not.toBeNull();
    }
  });

  test("no destino says so", async () => {
    await open({ targets: [] });
    expect(screen.queryByText("Nenhum destino SSH cadastrado.")).not.toBeNull();
    expect(rows()).toEqual([]);
  });

  test("the search narrows the list by name, host or user, and the tag and via filters narrow it too", async () => {
    await open();
    const type = async (label: string, value: string) => {
      const field = screen.queryByLabelText(label);
      expect(field).not.toBeNull();
      await act(async () => {
        fireEvent.change(field as HTMLElement, { target: { value } });
      });
    };
    await type("Buscar destino", "stg");
    expect(rows()).toHaveLength(1);
    await type("Buscar destino", "");
    await type("Etiqueta", "prod");
    expect(rows().map((r) => within(r).queryByText("vps") !== null)).toEqual([true]);
    await type("Etiqueta", "");
    await type("Aberto por", "outro");
    expect(rows()).toHaveLength(1);
    expect(within(rows()[0] as HTMLElement).queryByText("lab")).not.toBeNull();
  });
});
