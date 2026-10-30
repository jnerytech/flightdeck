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

const VALUE = "create-test-value-0123456789";
const PRIVATE_KEY =
  "-----BEGIN OPENSSH PRIVATE KEY-----\ngenerated-private-material\n-----END OPENSSH PRIVATE KEY-----\n";
const PUBLIC_KEY = "ssh-ed25519 AAAAC3NzaGeneratedPublic deploy";

/** The page over a store whose key generator and file picker are fakes. */
async function open() {
  const { platform } = memoryPlatform();
  const removed: string[] = [];
  platform.vault.generateKey = async () => ({ privateKey: PRIVATE_KEY, publicKey: PUBLIC_KEY });
  platform.vault.pickFile = async () => ({ path: "C:/keys/id_ed25519", text: PRIVATE_KEY });
  platform.vault.removeFile = async (path) => {
    removed.push(path);
  };
  const copied: string[] = [];
  platform.copyText = async (text) => {
    copied.push(text);
  };
  const store = new AppStore(platform, { baseDelayMs: 60_000 });
  const daemon = legacyDaemon(cleanups);
  await store.addHost({ name: "h", url: daemon.url, token: TOKEN });
  const view = render(<VaultPage store={store} state={store.getState()} />);
  return { store, removed, copied, view };
}

const click = async (name: string) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};

const fill = async (label: string, value: string) => {
  const field = screen.queryByLabelText(label);
  expect(field).not.toBeNull();
  await act(async () => {
    fireEvent.change(field as HTMLElement, { target: { value } });
  });
};

describe("cofre-ui: create", () => {
  test("the form stores a secret with its type, value and tags, and clears the value", async () => {
    const { store } = await open();
    await click("Novo segredo");
    await fill("Nome", "github");
    await fill("Tipo", "token");
    await fill("Valor", VALUE);
    await fill("Etiquetas (separadas por vírgula)", "ci, prod");
    await click("Guardar");
    await act(() => Bun.sleep(20));
    const [meta] = store.getState().secrets;
    expect(meta).toMatchObject({ name: "github", type: "token", tags: ["ci", "prod"] });
    expect(meta ? await store.vault.value(meta.id) : null).toBe(VALUE);
    expect(document.body.innerHTML).not.toContain(VALUE);
  });

  test("Guardar stays closed until there is a name and a value", async () => {
    await open();
    await click("Novo segredo");
    const save = () =>
      screen.queryByRole("button", { name: "Guardar" }) as HTMLButtonElement | null;
    expect(save()?.disabled).toBe(true);
    await fill("Nome", "github");
    expect(save()?.disabled).toBe(true);
    await fill("Valor", VALUE);
    expect(save()?.disabled).toBe(false);
  });

  test("Gerar chave SSH stores the private key as an ssh-key and shows the public key to copy", async () => {
    const { store, copied } = await open();
    await click("Novo segredo");
    await fill("Nome", "deploy");
    await click("Gerar chave SSH");
    expect(await screen.findByText(PUBLIC_KEY)).not.toBeNull();
    const [meta] = store.getState().secrets;
    expect(meta).toMatchObject({ name: "deploy", type: "ssh-key" });
    expect(meta ? await store.vault.value(meta.id) : null).toBe(PRIVATE_KEY);
    expect(document.body.innerHTML).not.toContain("generated-private-material");
    await click("Copiar chave pública");
    await act(() => Bun.sleep(20));
    expect(copied).toEqual([PUBLIC_KEY]);
  });

  test("Importar arquivo de chave keeps the original by default", async () => {
    const { store, removed } = await open();
    await click("Novo segredo");
    await fill("Nome", "imported");
    await click("Importar arquivo de chave");
    await act(() => Bun.sleep(20));
    expect(store.getState().secrets).toHaveLength(1);
    expect(removed).toEqual([]);
  });

  test("with the option on, Importar arquivo de chave deletes the original after storing it", async () => {
    const { store, removed } = await open();
    await click("Novo segredo");
    await fill("Nome", "imported");
    const box = screen.queryByLabelText("Apagar o arquivo original depois de importar");
    expect(box).not.toBeNull();
    await act(async () => {
      fireEvent.click(box as HTMLElement);
    });
    await click("Importar arquivo de chave");
    await act(() => Bun.sleep(20));
    expect(store.getState().secrets[0]?.type).toBe("ssh-key");
    expect(removed).toEqual(["C:/keys/id_ed25519"]);
  });
});
