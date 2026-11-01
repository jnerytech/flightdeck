import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { sshDaemon, sshTarget } from "./ssh-daemon.ts";
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

const KEY =
  "-----BEGIN OPENSSH PRIVATE KEY-----\nssh-link-test-key-material\n-----END OPENSSH PRIVATE KEY-----\n";
const PASSWORD = "ssh-link-test-password";

/**
 * The app on Conexões over one host that keeps a destino with the given auth, and a vault with
 * an ssh-key and a password, both allowed for that host unless `allowed` says otherwise.
 */
async function open(
  input: {
    auth?: "vault-key" | "password";
    secretRef?: "key" | "password" | null;
    allowed?: boolean;
    remove?: boolean;
  } = {},
) {
  const d = sshDaemon(cleanups);
  const platform = memoryPlatform(false, "pt-BR");
  const store = new AppStore(platform.platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const hostId = await store.addHost({ name: "pc", url: d.url, token: TOKEN });
  const allowedHosts = input.allowed === false ? ["local"] : [hostId];
  const key = await store.addSecret({
    name: "deploy key",
    type: "ssh-key",
    value: KEY,
    allowedHosts,
  });
  const password = await store.addSecret({
    name: "box password",
    type: "password",
    value: PASSWORD,
    allowedHosts,
  });
  await store.addSecret({
    name: "a token",
    type: "token",
    value: "ghp_aTokenThatIsNotAKey123456",
    allowedHosts,
  });
  const ref =
    input.secretRef === "key" ? key.id : input.secretRef === "password" ? password.id : null;
  if (input.auth) {
    d.targets.push(sshTarget({ id: "t1", name: "vps", auth: input.auth, secretRef: ref }));
  } else {
    d.targets.push(sshTarget({ id: "t1", name: "vps" }));
  }
  if (input.remove) await store.removeSecret(key.id);
  render(<App store={store} />);
  await settle(() => screen.queryByRole("button", { name: "Conexões" }) !== null);
  await act(async () => {
    fireEvent.click(screen.queryByRole("button", { name: "Conexões" }) as HTMLElement);
  });
  await settle(() => screen.queryByRole("button", { name: "Conectar vps" }) !== null);
  return { d, store, hostId, key, password };
}

const click = async (name: string) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
  await act(() => Bun.sleep(40));
};

const choose = async (label: string, value: string) => {
  const field = screen.queryByLabelText(label);
  expect(field).not.toBeNull();
  await act(async () => {
    fireEvent.change(field as HTMLElement, { target: { value } });
  });
};

describe("conexoes-ui with the vault: the form", () => {
  test("Chave do cofre authentication picks an ssh-key secret, and only those, and keeps its id as the reference", async () => {
    const { d, key } = await open();
    await click("Editar vps");
    await choose("Autenticação", "vault-key");
    const picker = screen.queryByLabelText("Chave do cofre") as HTMLSelectElement | null;
    expect(picker).not.toBeNull();
    expect([...(picker?.options ?? [])].map((o) => o.textContent)).toEqual([
      "Nenhum segredo",
      "deploy key",
    ]);
    await choose("Chave do cofre", key.id);
    await click("Salvar destino");
    expect(d.sent("ssh.save").at(-1)).toMatchObject({ auth: "vault-key", secretRef: key.id });
  });

  test("Salvar destino stays closed for a Chave do cofre without a key", async () => {
    await open();
    await click("Editar vps");
    await choose("Autenticação", "vault-key");
    expect(
      (screen.queryByRole("button", { name: "Salvar destino" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  test("Senha authentication may point at a password in the vault, or at none to be asked", async () => {
    const { d, password } = await open();
    await click("Editar vps");
    await choose("Autenticação", "password");
    const picker = screen.queryByLabelText("Senha no cofre") as HTMLSelectElement | null;
    expect([...(picker?.options ?? [])].map((o) => o.textContent)).toEqual([
      "Nenhum segredo",
      "box password",
    ]);
    await choose("Senha no cofre", password.id);
    await click("Salvar destino");
    expect(d.sent("ssh.save").at(-1)).toMatchObject({ auth: "password", secretRef: password.id });
  });
});

describe("conexoes-ui with the vault: connecting", () => {
  test("Conectar hands the key to the host that runs ssh, in the connect command and only there, and logs the use", async () => {
    const { d, store, hostId, key } = await open({ auth: "vault-key", secretRef: "key" });
    await click("Conectar vps");
    expect(d.sent("ssh.connect")).toEqual([
      { targetId: "t1", cols: 80, rows: 24, privateKey: KEY },
    ]);
    expect(JSON.stringify(d.commands.filter((c) => c.type !== "ssh.connect"))).not.toContain(
      "ssh-link-test-key-material",
    );
    expect(JSON.stringify(store.getState())).not.toContain("ssh-link-test-key-material");
    expect(document.body.innerHTML).not.toContain("ssh-link-test-key-material");
    expect(store.usage.list()[0]).toMatchObject({
      secretId: key.id,
      hostId,
      purpose: "ssh",
      requester: "you",
      kind: "delivered",
    });
    expect(JSON.stringify(store.usage.list())).not.toContain("ssh-link-test-key-material");
  });

  test("Testar conexão hands the key over too", async () => {
    const { d } = await open({ auth: "vault-key", secretRef: "key" });
    await click("Editar vps");
    await click("Testar conexão");
    expect(d.sent("ssh.test")).toEqual([{ targetId: "t1", privateKey: KEY }]);
  });

  test("a key not allowed for the host is refused with the reason, nothing is sent, and the refusal is logged", async () => {
    const { d, store, key } = await open({ auth: "vault-key", secretRef: "key", allowed: false });
    await click("Conectar vps");
    expect(d.sent("ssh.connect")).toEqual([]);
    expect(screen.queryByRole("alert")?.textContent).toBe(
      "O segredo não está liberado para este host.",
    );
    expect(store.usage.list()[0]).toMatchObject({
      secretId: key.id,
      purpose: "ssh",
      requester: "you",
      kind: "denied",
    });
  });

  test("a key that is gone from the vault is refused with the reason", async () => {
    const { d } = await open({ auth: "vault-key", secretRef: "key", remove: true });
    await click("Conectar vps");
    expect(d.sent("ssh.connect")).toEqual([]);
    expect(screen.queryByRole("alert")?.textContent).toBe("O cofre não tem esse segredo.");
  });
});

describe("conexoes-ui with the vault: ssh asks for a password", () => {
  const ask = async (d: Awaited<ReturnType<typeof open>>["d"], secretRef: string | null) => {
    await act(async () => {
      d.push({
        type: "askpass.request",
        requestId: "r1",
        targetId: "t1",
        targetName: "vps",
        kind: "password",
        secretRef,
        prompt: "deploy@vps's password:",
      });
    });
    await act(() => Bun.sleep(60));
  };

  test("a request with a reference to a password in the vault is answered from it, without a dialog, and logged", async () => {
    const { d, store, hostId, password } = await open({ auth: "password", secretRef: "password" });
    await ask(d, password.id);
    expect(d.sent("askpass.answer")).toEqual([{ requestId: "r1", secret: PASSWORD }]);
    expect(screen.queryByLabelText("Senha")).toBeNull();
    expect(store.usage.list()[0]).toMatchObject({
      secretId: password.id,
      hostId,
      purpose: "ssh",
      requester: "you",
      kind: "delivered",
    });
    expect(JSON.stringify(store.getState())).not.toContain(PASSWORD);
    expect(JSON.stringify(store.usage.list())).not.toContain(PASSWORD);
  });

  test("a reference the vault cannot honour falls back to the dialog", async () => {
    const { d } = await open({ auth: "password", secretRef: "password", allowed: false });
    const ref = d.targets[0]?.secretRef ?? null;
    await ask(d, ref);
    expect(d.sent("askpass.answer")).toEqual([]);
    expect(screen.queryByLabelText("Senha")).not.toBeNull();
  });

  test("a request without a reference opens the dialog as before", async () => {
    const { d } = await open({ auth: "password", secretRef: null });
    await ask(d, null);
    expect(screen.queryByLabelText("Senha")).not.toBeNull();
    expect(d.sent("askpass.answer")).toEqual([]);
  });
});
