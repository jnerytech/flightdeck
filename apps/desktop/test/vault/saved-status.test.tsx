import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform, TOKEN } from "../fixtures.ts";
import { legacyDaemon } from "../legacy-daemon.ts";
import { uiIdle } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { VaultPage } = await import("../../src/features/vault/page.tsx");

setDefaultTimeout(20_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const PRIVATE_KEY =
  "-----BEGIN OPENSSH PRIVATE KEY-----\nstatus-test-material\n-----END OPENSSH PRIVATE KEY-----\n";
const PUBLIC_KEY = "ssh-ed25519 AAAAC3NzaStatusPublic deploy";

/** The page over a store whose key generator and file picker are fakes the test can fail. */
async function open(options: { generates?: boolean; picks?: boolean } = {}) {
  const { platform } = memoryPlatform();
  platform.vault.generateKey = async () => {
    if (options.generates === false) throw new Error("ssh-keygen is missing");
    return { privateKey: PRIVATE_KEY, publicKey: PUBLIC_KEY };
  };
  platform.vault.pickFile = async () =>
    options.picks === false ? null : { path: "C:/keys/id_ed25519", text: PRIVATE_KEY };
  const store = new AppStore(platform, { baseDelayMs: 60_000 });
  const daemon = legacyDaemon(cleanups);
  await store.roster.add({ name: "h", url: daemon.url, token: TOKEN });
  render(<VaultPage store={store} />);
  return { store };
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

/** The polite region that holds a text, or null when the text is not on screen. */
const politeRegionOf = (text: string) =>
  screen.queryByText(text)?.closest("[aria-live=polite]") ?? null;

const GENERATED = "Chave SSH deploy salva no cofre. Copie a chave pública abaixo.";

describe("cofre-ui: a new key says it was saved in the vault (#4420)", () => {
  test("Gerar chave SSH says, by name and politely, that the private key is in the vault", async () => {
    await open();
    await click("Novo segredo");
    await fill("Nome", "deploy");
    await click("Gerar chave SSH");
    expect(politeRegionOf(GENERATED)).not.toBeNull();
    expect(screen.queryByText(PUBLIC_KEY)).not.toBeNull();
  });

  test("a generated key's status goes away with the form and does not repeat", async () => {
    await open();
    await click("Novo segredo");
    await fill("Nome", "deploy");
    await click("Gerar chave SSH");
    await click("Cancelar");
    expect(screen.queryByText(GENERATED)).toBeNull();
  });

  test("a failed Gerar chave SSH shows no success line and no public key", async () => {
    await open({ generates: false });
    await click("Novo segredo");
    await fill("Nome", "deploy");
    await click("Gerar chave SSH");
    expect(screen.queryByText(/salva no cofre/)).toBeNull();
    expect(screen.queryByText(PUBLIC_KEY)).toBeNull();
  });

  test("Importar arquivo de chave says what was imported once the form is closed", async () => {
    await open();
    await click("Novo segredo");
    await fill("Nome", "deploy");
    await click("Importar arquivo de chave");
    expect(screen.queryByLabelText("Nome")).toBeNull();
    expect(politeRegionOf("Chave deploy importada e salva no cofre")).not.toBeNull();
  });

  test("a cancelled file dialog says nothing was imported", async () => {
    await open({ picks: false });
    await click("Novo segredo");
    await fill("Nome", "deploy");
    await click("Importar arquivo de chave");
    expect(screen.queryByText(/importada/)).toBeNull();
  });

  test("Guardar says the secret was saved once the form is closed", async () => {
    await open();
    await click("Novo segredo");
    await fill("Nome", "github");
    await fill("Valor", "status-test-value-0123");
    await click("Guardar");
    expect(screen.queryByLabelText("Nome")).toBeNull();
    expect(politeRegionOf("github salvo")).not.toBeNull();
  });
});
