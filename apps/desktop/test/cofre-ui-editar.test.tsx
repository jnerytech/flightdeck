import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { legacyDaemon } from "./legacy-daemon.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { VaultPage } = await import("../src/ui/VaultPage.tsx");

setDefaultTimeout(20_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const VALUE = "edit-test-value-0123456789";
/** Generated with ssh-keygen -t ed25519. */
const KEY = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACCzEW5NqZ0HEON/fuAssJsD3vEvl8HsW1VaSEoamw1SEwAAAJB5pesveaXr
LwAAAAtzc2gtZWQyNTUxOQAAACCzEW5NqZ0HEON/fuAssJsD3vEvl8HsW1VaSEoamw1SEw
AAAEAzgY0LtZK5Q0sXfPaMLYBfcPMvmlqW/TeBmaQWohlem7MRbk2pnQcQ439+4CywmwPe
8S+XwexbVVpIShqbDVITAAAAB3Rlc3RAZmQBAgMEBQY=
-----END OPENSSH PRIVATE KEY-----
`;
const PUBLIC_KEY =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILMRbk2pnQcQ439+4CywmwPe8S+XwexbVVpIShqbDVIT";

async function settle(check: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await act(() => Bun.sleep(10));
}

/** The page over a store with a host named "box", a secret and a fake clipboard. */
async function open(input: { type: "password" | "ssh-key"; value: string; lastUsedAt?: number }) {
  const { platform } = memoryPlatform();
  const copied: string[] = [];
  platform.copyText = async (text) => {
    copied.push(text);
  };
  const store = new AppStore(platform, { baseDelayMs: 60_000 });
  const daemon = legacyDaemon(cleanups);
  const hostId = await store.addHost({ name: "box", url: daemon.url, token: TOKEN });
  const meta = await store.addSecret({ name: "deploy", type: input.type, value: input.value });
  if (input.lastUsedAt !== undefined) {
    await store.vault.restore({ ...meta, lastUsedAt: input.lastUsedAt }, input.value);
  }
  render(<VaultPage store={store} state={{ ...store.getState(), secrets: store.vault.list() }} />);
  await settle(() => store.getState().hosts.length > 0);
  return { store, hostId, meta, copied };
}

const click = async (name: string) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
  await act(() => Bun.sleep(20));
};

const fill = async (label: string, value: string) => {
  const field = screen.queryByLabelText(label);
  expect(field).not.toBeNull();
  await act(async () => {
    fireEvent.change(field as HTMLElement, { target: { value } });
  });
};

describe("cofre-ui: edit and details", () => {
  test("a row says it was never used, or when it was last used, and which hosts it may go to", async () => {
    await open({ type: "password", value: VALUE });
    expect(screen.queryByText("Nunca usado")).not.toBeNull();
    expect(screen.queryByText("Hosts permitidos: local")).not.toBeNull();
    cleanup();
    await open({ type: "password", value: VALUE, lastUsedAt: Date.UTC(2026, 9, 30, 12) });
    expect(screen.queryByText("Nunca usado")).toBeNull();
    expect(screen.queryByText(/^Último uso: /)).not.toBeNull();
  });

  test("Editar changes the name, description, tags and allowed hosts, and the value stays", async () => {
    const { store, hostId, meta } = await open({ type: "password", value: VALUE });
    await click("Editar deploy");
    await fill("Nome", "deploy prod");
    await fill("Descrição", "the prod box");
    await fill("Etiquetas (separadas por vírgula)", "prod, ssh");
    const box = screen.queryByLabelText("box");
    expect(box).not.toBeNull();
    await act(async () => {
      fireEvent.click(box as HTMLElement);
    });
    await click("Salvar alterações");
    expect(store.vault.list()[0]).toMatchObject({
      id: meta.id,
      name: "deploy prod",
      description: "the prod box",
      tags: ["prod", "ssh"],
      allowedHosts: ["local", hostId],
    });
    expect(await store.vault.value(meta.id)).toBe(VALUE);
    expect(store.getState().secrets[0]?.name).toBe("deploy prod");
  });

  test("Editar offers no field for the value", async () => {
    await open({ type: "password", value: VALUE });
    await click("Editar deploy");
    expect(screen.queryByLabelText("Valor")).toBeNull();
    expect(document.body.innerHTML).not.toContain(VALUE);
  });

  test("an ssh-key row has Copiar chave pública, which copies the public key and not the private one", async () => {
    const { copied } = await open({ type: "ssh-key", value: KEY });
    await settle(
      () => screen.queryByRole("button", { name: "Copiar chave pública de deploy" }) !== null,
    );
    await click("Copiar chave pública de deploy");
    expect(copied).toEqual([PUBLIC_KEY]);
  });

  test("a row that is not an ssh-key has no Copiar chave pública", async () => {
    await open({ type: "password", value: VALUE });
    expect(screen.queryByRole("button", { name: /Copiar chave pública/ })).toBeNull();
  });

  test("unticking an allowed host takes it off the secret", async () => {
    const { store, meta } = await open({ type: "password", value: VALUE });
    await click("Editar deploy");
    const box = screen.queryByLabelText("box");
    await act(async () => {
      fireEvent.click(box as HTMLElement);
    });
    await act(async () => {
      fireEvent.click(box as HTMLElement);
    });
    await click("Salvar alterações");
    expect(store.vault.list()[0]).toMatchObject({ id: meta.id, allowedHosts: ["local"] });
  });
});
