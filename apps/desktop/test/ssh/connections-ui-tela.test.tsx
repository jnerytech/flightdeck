import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform, TOKEN } from "../fixtures.ts";
import { stays, uiIdle, waiter } from "../wait.ts";
import { sshDaemon, sshTarget } from "./daemon.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { App } = await import("../../src/app/App.tsx");

setDefaultTimeout(20_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const settle = waiter(4000);

const TARGETS = [
  sshTarget({ id: "t1", name: "vps", host: "vps.example.com", tags: ["prod"] }),
  sshTarget({
    id: "t2",
    name: "staging",
    host: "stg.example.com",
    user: "ci",
    port: 2222,
    tags: ["homolog", "cliente X"],
  }),
  sshTarget({ id: "t3", name: "lab", host: "lab.local", viaHost: "outro", tags: [] }),
];

/** The app over a phase 15 daemon, on the Conexões screen. */
async function open(options: Parameters<typeof sshDaemon>[1] = { targets: TARGETS }) {
  const d = sshDaemon(cleanups, options);
  const store = new AppStore(memoryPlatform(false, "pt-BR").platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const hostId = await store.roster.add({ name: "pc", url: d.url, token: TOKEN });
  await settle(() => store.getState().hosts.every((h) => h.status === "online"));
  await settle(() => store.getState().hosts[0]?.hostInfo != null);
  render(<App store={store} />);
  // Mounting the app reconnects the host, which announces its features again.
  await settle(() => screen.queryByRole("button", { name: "SSH" }) !== null);
  const nav = screen.queryByRole("button", { name: "SSH" });
  expect(nav).not.toBeNull();
  await act(async () => {
    fireEvent.click(nav as HTMLElement);
  });
  await settle(() => d.commands.some((c) => c.type === "ssh.list"));
  await uiIdle();
  return { d, store, hostId };
}

const rows = () => {
  const list = screen.queryByRole("list", { name: "Destinos" });
  // A row holds a list of its own facts: only the direct items are rows.
  return list
    ? within(list)
        .queryAllByRole("listitem")
        .filter((item) => item.parentElement === list)
    : [];
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
    await store.roster.add({ name: "pc", url: d.url, token: TOKEN });
    await settle(() => store.getState().hosts.every((h) => h.status === "online"));
    await settle(() => d.commands.some((c) => c.type === "host.info"));
    render(<App store={store} />);
    await stays(() => screen.queryByRole("button", { name: "SSH" }) === null, 100);
    expect(screen.queryByRole("button", { name: "SSH" })).toBeNull();
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

  test("the empty list offers its own button to add the first target", async () => {
    await open({ targets: [] });
    const button = screen.queryByRole("button", { name: "Cadastrar o primeiro destino" });
    expect(button).not.toBeNull();
    await act(async () => {
      fireEvent.click(button as HTMLElement);
    });
    await settle(() => screen.queryByLabelText("Nome") !== null);
    expect(screen.queryByLabelText("Nome")).not.toBeNull();
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

  test("a search that matches nothing says so and a button clears the three filters (#3705)", async () => {
    await open();
    const search = screen.queryByLabelText("Buscar destino") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(search, { target: { value: "zzz" } });
    });
    expect(screen.queryByText("Nenhum destino corresponde aos filtros.")).not.toBeNull();
    const clear = screen.queryByRole("button", { name: "Limpar filtros" });
    expect(clear).not.toBeNull();
    await act(async () => {
      fireEvent.click(clear as HTMLElement);
    });
    expect(rows()).toHaveLength(3);
    expect((screen.queryByLabelText("Buscar destino") as HTMLInputElement).value).toBe("");
    expect(screen.queryByText("Nenhum destino corresponde aos filtros.")).toBeNull();
  });

  test("with no host that announces ssh the page says so, offers no dead button and has no empty host name (#3705)", async () => {
    const { store, hostId } = await open({ targets: [] });
    const plain = sshDaemon(cleanups, { feature: false });
    await store.roster.add({ name: "plain", url: plain.url, token: TOKEN });
    await settle(() =>
      store.getState().hosts.some((h) => h.name === "plain" && h.hostInfo != null),
    );
    await act(async () => {
      await store.roster.remove(hostId);
    });
    await settle(() => store.getState().hosts.length === 1);
    await uiIdle();
    expect(
      screen.queryByText(
        "Nenhum host conectado oferece SSH. Atualize o daemon de um host ou conecte um que ofereça.",
      ),
    ).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Cadastrar o primeiro destino" })).toBeNull();
    expect(screen.queryByText(/do host \./)).toBeNull();
  });

  test("when the ssh host is offline the page names it and says to reconnect it (#3705)", async () => {
    const { d, store } = await open({ targets: [] });
    d.stop();
    await settle(() => store.getState().hosts.every((h) => h.status !== "online"));
    await uiIdle();
    expect(
      screen.queryByText(
        "O host pc, que guarda os destinos, está offline. Reconecte-o para gerenciá-los.",
      ),
    ).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Cadastrar o primeiro destino" })).toBeNull();
  });

  test("until ssh.list answers the page shows a loading line, not the empty state or the filters (#4334)", async () => {
    const d = sshDaemon(cleanups, { targets: TARGETS, hold: ["ssh.list"] });
    const store = new AppStore(memoryPlatform(false, "pt-BR").platform, { baseDelayMs: 60_000 });
    cleanups.push(() => store.dispose());
    await store.roster.add({ name: "pc", url: d.url, token: TOKEN });
    await settle(() => store.getState().hosts[0]?.hostInfo != null);
    render(<App store={store} />);
    await settle(() => screen.queryByRole("button", { name: "SSH" }) !== null);
    await act(async () => {
      fireEvent.click(screen.queryByRole("button", { name: "SSH" }) as HTMLElement);
    });
    await settle(() => d.commands.some((c) => c.type === "ssh.list"));
    await uiIdle();
    expect(screen.queryByText("Carregando os destinos…")).not.toBeNull();
    expect(screen.queryByText("Nenhum destino SSH cadastrado.")).toBeNull();
    expect(screen.queryByLabelText("Buscar destino")).toBeNull();
    await act(async () => {
      d.release("ssh.list");
    });
    await settle(() => rows().length === 3);
    expect(screen.queryByText("Carregando os destinos…")).toBeNull();
  });

  test("a refused ssh.list says so with a Retry, and Retry shows the list (#4334)", async () => {
    const refuse = ["ssh.list"];
    await open({ targets: TARGETS, refuse });
    expect(screen.queryByText("Não foi possível ler os destinos.")).not.toBeNull();
    expect(screen.queryByText("Nenhum destino SSH cadastrado.")).toBeNull();
    refuse.length = 0;
    const retry = screen.queryByRole("button", { name: "Tentar de novo" });
    expect(retry).not.toBeNull();
    await act(async () => {
      fireEvent.click(retry as HTMLElement);
    });
    await settle(() => rows().length === 3);
    expect(screen.queryByText("Não foi possível ler os destinos.")).toBeNull();
  });

  test("with no destination the filter row is not rendered (#4334)", async () => {
    await open({ targets: [] });
    expect(screen.queryByText("Nenhum destino SSH cadastrado.")).not.toBeNull();
    expect(screen.queryByLabelText("Buscar destino")).toBeNull();
    expect(screen.queryByLabelText("Etiqueta")).toBeNull();
  });

  test("the no-host and the offline-host states have a button that opens the host (#4334)", async () => {
    const { d, store, hostId } = await open({ targets: [] });
    d.stop();
    await settle(() => store.getState().hosts.every((h) => h.status !== "online"));
    await uiIdle();
    const goHost = screen.queryByRole("button", { name: "Abrir o host pc" });
    expect(goHost).not.toBeNull();
    await act(async () => {
      fireEvent.click(goHost as HTMLElement);
    });
    expect(store.router.current).toEqual({ name: "host", host: hostId });
  });

  test("Duplicar is busy until ssh.save answers, and a second click saves nothing more (#4334)", async () => {
    const { d } = await open({ targets: TARGETS, hold: ["ssh.save"] });
    const duplicate = screen.queryByRole("button", { name: "Duplicar vps" }) as HTMLElement;
    await act(async () => {
      fireEvent.click(duplicate);
      fireEvent.click(duplicate);
    });
    await settle(() => d.sent("ssh.save").length > 0);
    expect(duplicate.getAttribute("aria-busy")).toBe("true");
    await act(async () => {
      d.release("ssh.save");
    });
    await settle(() => rows().length === 4);
    expect(d.sent("ssh.save")).toHaveLength(1);
    expect(duplicate.getAttribute("aria-busy")).toBeNull();
  });

  test("Conectar is busy while the key is checked, and a second click starts no second connection (#4334)", async () => {
    const { d } = await open({ targets: TARGETS, hold: ["ssh.hostkey.check"] });
    const connect = screen.queryByRole("button", { name: "Conectar vps" }) as HTMLElement;
    await act(async () => {
      fireEvent.click(connect);
      fireEvent.click(connect);
    });
    await settle(() => d.sent("ssh.hostkey.check").length > 0);
    expect(connect.getAttribute("aria-busy")).toBe("true");
    await act(async () => {
      d.release("ssh.hostkey.check");
    });
    await settle(() => d.sent("ssh.connect").length > 0);
    expect(d.sent("ssh.hostkey.check")).toHaveLength(1);
    expect(d.sent("ssh.connect")).toHaveLength(1);
  });

  test("when the host that keeps the destinations goes away, the next host's failed read shows no rows of the first (#4334)", async () => {
    const { d, store } = await open();
    expect(rows()).toHaveLength(3);
    const next = sshDaemon(cleanups, { targets: [], refuse: ["ssh.list"] });
    await store.roster.add({ name: "pc2", url: next.url, token: TOKEN });
    await settle(() => store.getState().hosts.some((h) => h.name === "pc2" && h.hostInfo != null));
    d.stop();
    await settle(() => store.getState().hosts.some((h) => h.status !== "online"));
    await settle(() => screen.queryByText("Não foi possível ler os destinos.") !== null);
    expect(rows()).toHaveLength(0);
  });

  test("a failed reload after a change keeps the list the person was looking at (#4334)", async () => {
    const refuse: string[] = [];
    const { d } = await open({ targets: TARGETS, refuse });
    refuse.push("ssh.list");
    const duplicate = screen.queryByRole("button", { name: "Duplicar vps" }) as HTMLElement;
    await act(async () => {
      fireEvent.click(duplicate);
    });
    await settle(() => d.sent("ssh.save").length > 0);
    await uiIdle();
    expect(rows()).toHaveLength(3);
    expect(screen.queryByText("Não foi possível ler os destinos.")).toBeNull();
  });

  test("each destino says how it signs in, which host opens it and whether its server key is confirmed (#4334)", async () => {
    await open({
      targets: [
        sshTarget({
          id: "t1",
          name: "vps",
          auth: "key-file",
          secretRef: "/k",
          hostKey: "SHA256:abc",
        }),
        sshTarget({ id: "t3", name: "lab", viaHost: "outro", auth: "password" }),
      ],
    });
    const vps = within(rows()[0] as HTMLElement);
    // The three facts are the items of a list, so a screen reader pauses between them.
    expect(vps.queryAllByRole("listitem")).toHaveLength(3);
    expect(vps.queryByText("Chave em arquivo")).not.toBeNull();
    expect(vps.queryByText("Aberto por este host")).not.toBeNull();
    expect(vps.queryByText("Chave do servidor confirmada")).not.toBeNull();
    expect(vps.queryByText("Chave do servidor ainda não confirmada")).toBeNull();
    const lab = within(rows()[1] as HTMLElement);
    expect(lab.queryByText("Senha (pedida ao conectar)")).not.toBeNull();
    expect(lab.queryByText("Aberto por outro")).not.toBeNull();
    expect(lab.queryByText("Chave do servidor ainda não confirmada")).not.toBeNull();
  });
});
