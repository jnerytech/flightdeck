import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { type SshDaemonOptions, sshDaemon, sshTarget } from "./ssh-daemon.ts";
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

const VPS = sshTarget({
  id: "t1",
  name: "vps",
  host: "vps.example.com",
  tags: ["prod"],
  hostKey: "SHA256:kept",
  auth: "key-file",
  secretRef: "~/.ssh/id_vps",
});
const LAB = sshTarget({ id: "t2", name: "lab" });

/** The app on the Conexões screen of a phase 15 daemon. */
async function open(options: SshDaemonOptions = { targets: [VPS, LAB] }) {
  const d = sshDaemon(cleanups, options);
  const store = new AppStore(memoryPlatform(false, "pt-BR").platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  await store.addHost({ name: "pc", url: d.url, token: TOKEN });
  render(<App store={store} />);
  await settle(() => screen.queryByRole("button", { name: "Conexões" }) !== null);
  await act(async () => {
    fireEvent.click(screen.queryByRole("button", { name: "Conexões" }) as HTMLElement);
  });
  await settle(() => d.commands.some((c) => c.type === "ssh.list"));
  await act(() => Bun.sleep(30));
  return { d, store };
}

const click = async (name: string) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
  await act(() => Bun.sleep(30));
};

const fill = async (label: string, value: string) => {
  const field = screen.queryByLabelText(label);
  expect(field).not.toBeNull();
  await act(async () => {
    fireEvent.change(field as HTMLElement, { target: { value } });
  });
};

const tick = async (label: string) => {
  const box = screen.queryByLabelText(label);
  expect(box).not.toBeNull();
  await act(async () => {
    fireEvent.click(box as HTMLElement);
  });
};

describe("conexoes-ui: the form", () => {
  test("Novo destino saves what was typed, with the key file path as the reference", async () => {
    const { d } = await open({ targets: [] });
    await click("Novo destino");
    await fill("Nome", "nova");
    await fill("Host", "nova.example.com");
    await fill("Usuário", "me");
    await fill("Porta", "2200");
    await fill("Autenticação", "key-file");
    await fill("Arquivo de chave", "~/.ssh/id_nova");
    await fill("Etiquetas (separadas por vírgula)", "prod, cliente X");
    await click("Salvar destino");
    expect(d.sent("ssh.save")).toEqual([
      {
        name: "nova",
        host: "nova.example.com",
        port: 2200,
        user: "me",
        viaHost: null,
        auth: "key-file",
        secretRef: "~/.ssh/id_nova",
        jump: null,
        options: {},
        tags: ["prod", "cliente X"],
      },
    ]);
    expect(screen.queryByText("me@nova.example.com:2200")).not.toBeNull();
  });

  test("Salvar destino stays closed until there is a name, a host and a user", async () => {
    await open({ targets: [] });
    await click("Novo destino");
    const save = () =>
      screen.queryByRole("button", { name: "Salvar destino" }) as HTMLButtonElement;
    expect(save().disabled).toBe(true);
    await fill("Nome", "x");
    await fill("Host", "x.example.com");
    expect(save().disabled).toBe(true);
    await fill("Usuário", "me");
    expect(save().disabled).toBe(false);
  });

  test("Editar opens the destino filled in and saves the change under the same id", async () => {
    const { d } = await open();
    await click("Editar vps");
    expect((screen.queryByLabelText("Host") as HTMLInputElement).value).toBe("vps.example.com");
    expect((screen.queryByLabelText("Arquivo de chave") as HTMLInputElement).value).toBe(
      "~/.ssh/id_vps",
    );
    await fill("Host", "novo.example.com");
    await click("Salvar destino");
    expect(d.sent("ssh.save")[0]).toMatchObject({
      id: "t1",
      host: "novo.example.com",
      name: "vps",
    });
    expect(screen.queryByText("deploy@novo.example.com")).not.toBeNull();
  });

  test("Duplicar saves a copy named after the original, without its id and its server key", async () => {
    const { d } = await open();
    await click("Duplicar vps");
    const sent = d.sent("ssh.save")[0] as Record<string, unknown>;
    expect(sent).toMatchObject({
      name: "vps (cópia)",
      host: "vps.example.com",
      auth: "key-file",
      secretRef: "~/.ssh/id_vps",
      tags: ["prod"],
    });
    expect(sent.id).toBeUndefined();
    expect(sent.hostKey).toBeUndefined();
    expect(screen.queryByText("vps (cópia)")).not.toBeNull();
  });

  test("Remover asks first and then removes with the confirmation the daemon needs", async () => {
    const { d } = await open();
    await click("Remover lab");
    expect(d.sent("ssh.remove")).toEqual([]);
    await click("Remover");
    expect(d.sent("ssh.remove")).toEqual([{ id: "t2", confirm: true }]);
    expect(screen.queryByText("lab")).toBeNull();
  });

  test("cancelling the removal keeps the destino", async () => {
    const { d } = await open();
    await click("Remover lab");
    await click("Cancelar");
    expect(d.sent("ssh.remove")).toEqual([]);
    expect(screen.queryByText("lab")).not.toBeNull();
  });

  test("turning ForwardAgent on asks first, and saving it sends the confirmation", async () => {
    const { d } = await open();
    await click("Editar lab");
    await tick("Encaminhar o agente (ForwardAgent)");
    await click("Ligar o encaminhamento");
    await click("Salvar destino");
    expect(d.sent("ssh.save")[0]).toMatchObject({
      id: "t2",
      options: { forwardAgent: true },
      confirm: true,
    });
  });

  test("declining the ForwardAgent question leaves it off", async () => {
    const { d } = await open();
    await click("Editar lab");
    await tick("Encaminhar o agente (ForwardAgent)");
    await click("Cancelar");
    expect(
      (screen.queryByLabelText("Encaminhar o agente (ForwardAgent)") as HTMLInputElement).checked,
    ).toBe(false);
    await click("Salvar destino");
    const sent = d.sent("ssh.save")[0] as { options: Record<string, unknown>; confirm?: boolean };
    expect(sent.options.forwardAgent).toBeUndefined();
    expect(sent.confirm).toBeUndefined();
  });

  test("the form shows the kept server key and Esquecer chave do servidor forgets it", async () => {
    const { d } = await open();
    await click("Editar vps");
    expect(screen.queryByText("SHA256:kept")).not.toBeNull();
    await click("Esquecer chave do servidor");
    // The confirmation comes first: the key stays until it is accepted.
    expect(d.sent("ssh.hostkey.forget")).toEqual([]);
    await click("Cancelar");
    expect(d.sent("ssh.hostkey.forget")).toEqual([]);
    expect(screen.queryByText("SHA256:kept")).not.toBeNull();
    await click("Esquecer chave do servidor");
    await click("Esquecer chave");
    expect(d.sent("ssh.hostkey.forget")).toEqual([{ targetId: "t1" }]);
    expect(screen.queryByText("SHA256:kept")).toBeNull();
  });
});

describe("conexoes-ui: the connection test", () => {
  test("Testar conexão runs ssh.test for the destino and says it worked", async () => {
    const { d } = await open();
    await click("Editar vps");
    await click("Testar conexão");
    expect(d.sent("ssh.test")).toEqual([{ targetId: "t1" }]);
    expect(screen.queryByText("Conexão ok.")).not.toBeNull();
  });

  test("a failed test shows the error the daemon translated", async () => {
    const { d } = await open({
      targets: [VPS],
      test: { ok: false, error: "O servidor recusou a chave." },
    });
    await click("Editar vps");
    await click("Testar conexão");
    expect(d.sent("ssh.test")).toHaveLength(1);
    expect(screen.queryByText("O servidor recusou a chave.")).not.toBeNull();
    expect(screen.queryByText("Conexão ok.")).toBeNull();
  });

  test("a failed test with a reason shows the app's sentence for it, not the daemon's English", async () => {
    await open({
      targets: [VPS],
      test: { ok: false, error: "authentication refused", reason: "ssh_test_auth" },
    });
    await click("Editar vps");
    await click("Testar conexão");
    expect(screen.queryByRole("status")?.textContent).not.toBe("authentication refused");
    expect(screen.queryByRole("status")?.textContent).toContain(
      "O servidor recusou a autenticação",
    );
  });

  test("a destino that is not saved yet cannot be tested", async () => {
    await open({ targets: [] });
    await click("Novo destino");
    expect(
      (screen.queryByRole("button", { name: "Testar conexão" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  test("the jump, the host that opens it, keep-alive, compression and local forwards are saved; ForwardAgent ticked and then cleared stays off", async () => {
    const { d, store } = await open();
    const hostId = store.getState().hosts[0]?.id ?? "";
    await click("Editar lab");
    await fill("Salto (ProxyJump)", "t1");
    await fill("Aberto pelo host", hostId);
    await fill("Manter a conexão viva (segundos)", "30");
    await tick("Compressão");
    await fill("Encaminhamentos locais (um por linha)", "8080:localhost:80\n\n9090:db:5432");
    await tick("Encaminhar o agente (ForwardAgent)");
    await click("Ligar o encaminhamento");
    await tick("Encaminhar o agente (ForwardAgent)");
    await click("Salvar destino");
    const sent = d.sent("ssh.save")[0] as Record<string, unknown>;
    expect(sent).toMatchObject({
      id: "t2",
      jump: "t1",
      viaHost: hostId,
      options: {
        serverAliveInterval: 30,
        compression: true,
        localForward: ["8080:localhost:80", "9090:db:5432"],
      },
    });
    expect((sent.options as Record<string, unknown>).forwardAgent).toBeUndefined();
    expect(sent.confirm).toBeUndefined();
  });

  test("Cancelar closes the form without saving", async () => {
    const { d } = await open();
    await click("Editar lab");
    await fill("Nome", "outro");
    await click("Cancelar");
    expect(screen.queryByRole("button", { name: "Salvar destino" })).toBeNull();
    expect(d.sent("ssh.save")).toEqual([]);
  });
});
