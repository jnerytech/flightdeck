import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform, TOKEN } from "../fixtures.ts";
import { uiIdle, waiter } from "../wait.ts";
import { type SshDaemonOptions, sshDaemon, sshTarget } from "./daemon.ts";

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
  await store.roster.add({ name: "pc", url: d.url, token: TOKEN });
  render(<App store={store} />);
  await settle(() => screen.queryByRole("button", { name: "SSH" }) !== null);
  await act(async () => {
    fireEvent.click(screen.queryByRole("button", { name: "SSH" }) as HTMLElement);
  });
  await settle(() => d.commands.some((c) => c.type === "ssh.list"));
  await uiIdle();
  return { d, store };
}

const click = async (name: string) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
  await uiIdle();
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

  test("a port that is not a whole number from 1 to 65535 is flagged and blocks the save (#3705)", async () => {
    const { d } = await open({ targets: [] });
    await click("Novo destino");
    await fill("Nome", "x");
    await fill("Host", "x.example.com");
    await fill("Usuário", "me");
    const save = () =>
      screen.queryByRole("button", { name: "Salvar destino" }) as HTMLButtonElement;
    for (const bad of ["abc", "0", "70000", "-1"]) {
      await fill("Porta", bad);
      expect(screen.queryByText("Use um número inteiro de 1 a 65535.")).not.toBeNull();
      expect(screen.queryByText("Corrija os campos marcados para salvar.")).not.toBeNull();
      expect(save().disabled).toBe(true);
    }
    await fill("Porta", "2222");
    expect(screen.queryByText("Use um número inteiro de 1 a 65535.")).toBeNull();
    expect(save().disabled).toBe(false);
    await click("Salvar destino");
    expect(d.sent("ssh.save").map((s) => s.port)).toEqual([2222]);
  });

  test("a keep-alive that is not a whole number of 0 or more is flagged, and an empty one is allowed (#3705)", async () => {
    const { d } = await open({ targets: [] });
    await click("Novo destino");
    await fill("Nome", "x");
    await fill("Host", "x.example.com");
    await fill("Usuário", "me");
    const save = () =>
      screen.queryByRole("button", { name: "Salvar destino" }) as HTMLButtonElement;
    for (const bad of ["abc", "-1", "1.5", "99999999999999999999"]) {
      await fill("Manter a conexão viva (segundos)", bad);
      expect(
        screen.queryByText("Use um número inteiro de 0 ou mais, ou deixe em branco."),
      ).not.toBeNull();
      expect(save().disabled).toBe(true);
    }
    await fill("Manter a conexão viva (segundos)", "");
    expect(save().disabled).toBe(false);
    await click("Salvar destino");
    expect(d.sent("ssh.save").map((s) => s.options)).toEqual([{}]);
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
      screen
        .queryByRole("switch", { name: "Encaminhar o agente (ForwardAgent)" })
        ?.getAttribute("aria-checked"),
    ).toBe("false");
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
    // The tab strip's position announcement is a status too: read them all.
    const said = screen
      .queryAllByRole("status")
      .map((el) => el.textContent ?? "")
      .join(" ");
    expect(said).not.toContain("authentication refused");
    expect(said).toContain("O servidor recusou a autenticação");
  });

  test("a destino that is not saved yet has no Test button, since there is nothing saved to test (#4330)", async () => {
    await open({ targets: [] });
    await click("Novo destino");
    expect(screen.queryByRole("button", { name: "Salvar destino" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Testar conexão" })).toBeNull();
  });

  test("a change in the form turns Test off and says to save first (#4330)", async () => {
    await open();
    await click("Editar vps");
    expect(
      (screen.queryByRole("button", { name: "Testar conexão" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(screen.queryByText("Salve para testar estes valores")).toBeNull();
    await fill("Host", "outro.example.com");
    expect(
      (screen.queryByRole("button", { name: "Testar conexão" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.queryByText("Salve para testar estes valores")).not.toBeNull();
    // Back to the saved value: the saved destino can be tested again.
    await fill("Host", "vps.example.com");
    expect(
      (screen.queryByRole("button", { name: "Testar conexão" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  test("the result of a test goes away when the form changes, since it was about the saved values (#4330)", async () => {
    await open();
    await click("Editar vps");
    await click("Testar conexão");
    expect(screen.queryByText("Conexão ok.")).not.toBeNull();
    await fill("Porta", "2222");
    expect(screen.queryByText("Conexão ok.")).toBeNull();
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

describe("conexoes-ui: the form explains itself (#4333)", () => {
  const save = () => screen.queryByRole("button", { name: "Salvar destino" }) as HTMLButtonElement;

  test("a disabled Salvar destino names the required fields still empty, and the reason goes when they are filled", async () => {
    await open({ targets: [] });
    await click("Novo destino");
    expect(save().disabled).toBe(true);
    expect(screen.queryByText("Preencha para salvar: Nome, Host, Usuário.")).not.toBeNull();
    await fill("Nome", "x");
    expect(screen.queryByText("Preencha para salvar: Host, Usuário.")).not.toBeNull();
    await fill("Host", "x.example.com");
    await fill("Usuário", "me");
    expect(screen.queryByText(/Preencha para salvar/)).toBeNull();
    expect(save().disabled).toBe(false);
    await fill("Autenticação", "vault-key");
    expect(screen.queryByText("Preencha para salvar: Chave do cofre.")).not.toBeNull();
    expect(save().disabled).toBe(true);
  });

  test("the required fields are marked for a screen reader, and the optional ones are not", async () => {
    await open({ targets: [] });
    await click("Novo destino");
    for (const label of ["Nome", "Host", "Usuário"]) {
      expect(screen.queryByLabelText(label)?.getAttribute("aria-required")).toBe("true");
    }
    for (const label of ["Porta", "Etiquetas (separadas por vírgula)"]) {
      expect(screen.queryByLabelText(label)?.getAttribute("aria-required")).toBeNull();
    }
  });

  test("the Nome field has the focus when the form opens, for a new destino and for an edit", async () => {
    await open();
    await click("Novo destino");
    const focused = () => document.activeElement === screen.queryByLabelText("Nome");
    expect(focused()).toBe(true);
    await click("Cancelar");
    await click("Editar lab");
    expect(focused()).toBe(true);
  });

  test("the fields that are easy to misread say what they take", async () => {
    await open({ targets: [] });
    await click("Novo destino");
    expect(screen.queryByText(/O host que executa o ssh deste destino/)).not.toBeNull();
    expect(
      screen.queryByText(/Outro destino salvo pelo qual a conexão passa antes/),
    ).not.toBeNull();
    expect(screen.queryByText(/por exemplo 8080:localhost:80/)).not.toBeNull();
    expect(screen.queryByText(/O caminho é lido no host que executa o ssh/)).toBeNull();
    await fill("Autenticação", "key-file");
    expect(screen.queryByText(/O caminho é lido no host que executa o ssh/)).not.toBeNull();
  });

  test("a local forward that the daemon would refuse is flagged on its line and blocks the save", async () => {
    const { d } = await open({ targets: [] });
    await click("Novo destino");
    await fill("Nome", "x");
    await fill("Host", "x.example.com");
    await fill("Usuário", "me");
    const lines = "Encaminhamentos locais (um por linha)";
    for (const bad of ["bad line", "0:localhost:80", "8080:localhost:70000", "8080:localhost"]) {
      await fill(lines, `8080:localhost:80\n${bad}`);
      expect(
        screen.queryByText(`"${bad}" não é porta-local:host:porta-remota (portas de 1 a 65535).`),
      ).not.toBeNull();
      expect(screen.queryByText("Corrija os campos marcados para salvar.")).not.toBeNull();
      expect(save().disabled).toBe(true);
    }
    await fill(lines, "8080:localhost:80\n\n127.0.0.1:9090:db:5432");
    expect(screen.queryByText(/não é porta-local:host:porta-remota/)).toBeNull();
    expect(save().disabled).toBe(false);
    await click("Salvar destino");
    expect(d.sent("ssh.save")[0]).toMatchObject({
      options: { localForward: ["8080:localhost:80", "127.0.0.1:9090:db:5432"] },
    });
  });

  test("more than 20 local forwards are flagged, as the daemon refuses them", async () => {
    await open({ targets: [] });
    await click("Novo destino");
    await fill("Nome", "x");
    await fill("Host", "x.example.com");
    await fill("Usuário", "me");
    const many = Array.from({ length: 21 }, (_, i) => `${8000 + i}:db:5432`).join("\n");
    await fill("Encaminhamentos locais (um por linha)", many);
    expect(screen.queryByText("Use no máximo 20 encaminhamentos.")).not.toBeNull();
    expect(save().disabled).toBe(true);
  });
});

describe("conexoes-ui: the advanced options fold away (#4333)", () => {
  const SUMMARY = "Opções avançadas";
  const ADVANCED = sshTarget({ id: "t3", name: "adv", options: { compression: true } });
  const fold = () => screen.queryByText(SUMMARY)?.closest("details") ?? null;

  test("the basics stay in view and the rest folds under one closed summary", async () => {
    await open({ targets: [VPS] });
    await click("Novo destino");
    const advanced = fold();
    expect(advanced).not.toBeNull();
    expect(advanced?.open).toBe(false);
    for (const label of [
      "Aberto pelo host",
      "Salto (ProxyJump)",
      "Manter a conexão viva (segundos)",
    ]) {
      expect(advanced?.contains(screen.queryByLabelText(label))).toBe(true);
    }
    for (const label of ["Encaminhamentos locais (um por linha)", "Compressão"]) {
      expect(advanced?.contains(screen.queryByLabelText(label))).toBe(true);
    }
    for (const label of ["Nome", "Host", "Usuário", "Porta", "Etiquetas (separadas por vírgula)"]) {
      const field = screen.queryByLabelText(label);
      expect(field).not.toBeNull();
      expect(advanced?.contains(field)).toBe(false);
    }
  });

  test("a destino with an advanced option opens with the fold open; one without keeps it closed", async () => {
    await open({ targets: [VPS, ADVANCED] });
    await click("Editar vps");
    expect(fold()?.open).toBe(false);
    await click("Cancelar");
    await click("Editar adv");
    expect(fold()?.open).toBe(true);
  });

  test("Compressão and the agent are switches, and a saved option shows on", async () => {
    await open({ targets: [ADVANCED] });
    await click("Editar adv");
    const compression = screen.queryByRole("switch", { name: "Compressão" });
    expect(compression?.getAttribute("aria-checked")).toBe("true");
    const agent = screen.queryByRole("switch", { name: "Encaminhar o agente (ForwardAgent)" });
    expect(agent?.getAttribute("aria-checked")).toBe("false");
  });

  test("a value the fold holds that blocks Salvar destino keeps the fold open", async () => {
    await open({ targets: [VPS] });
    await click("Novo destino");
    await fill("Manter a conexão viva (segundos)", "abc");
    expect(fold()).not.toBeNull();
    const advanced = fold() as HTMLDetailsElement;
    await act(async () => {
      advanced.open = true;
      advanced.dispatchEvent(new Event("toggle"));
    });
    await act(async () => {
      advanced.open = false;
      advanced.dispatchEvent(new Event("toggle"));
    });
    expect(fold()?.open).toBe(true);
  });
});
