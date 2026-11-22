import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import {
  exportVault,
  fromFdvault,
  previewImport,
  toFdvault,
} from "../../src/features/vault/domain/vault-backup.ts";
import { type SecretMeta, Vault } from "../../src/features/vault/vault.ts";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform, TOKEN } from "../fixtures.ts";
import { legacyDaemon } from "../legacy-daemon.ts";
import { settle, uiIdle } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { VaultPage } = await import("../../src/features/vault/page.tsx");

setDefaultTimeout(30_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const PASS = "correct horse battery";
const VALUE = "backup-ui-value-0123456789";

/** A vault in memory, to make a backup from, with a secret whose id is fixed. */
async function sourceVault(withSecret = true) {
  const keyring = new Map<string, string>();
  const storage = new Map<string, string>();
  const vault = new Vault(
    {
      storage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => {
          storage.set(key, value);
        },
      },
      vault: {
        get: async (id) => keyring.get(id) ?? null,
        set: async (id, value) => {
          keyring.set(id, value);
        },
        delete: async (id) => {
          keyring.delete(id);
        },
        generateKey: async () => ({ privateKey: "", publicKey: "" }),
        pickFile: async () => null,
        removeFile: async () => {},
      },
    },
    { clock: () => 1, newId: () => "shared-id" },
  );
  if (withSecret) await vault.create({ name: "github", type: "token", value: VALUE });
  return vault;
}

async function backupText(): Promise<string> {
  return toFdvault(await exportVault(await sourceVault(), PASS, PASS, { workFactor: 4 }));
}

/** The page over a store whose save dialog and file picker are fakes. */
async function open(picked: string | null = null) {
  const { platform } = memoryPlatform();
  const saved: Array<{ name: string; text: string }> = [];
  platform.saveFile = async (name, text) => {
    saved.push({ name, text });
    return true;
  };
  platform.vault.pickFile = async () =>
    picked === null ? null : { path: "x.fdvault", text: picked };
  const store = new AppStore(platform, { baseDelayMs: 60_000, vaultWorkFactor: 4 });
  const daemon = legacyDaemon(cleanups);
  await store.roster.add({ name: "h", url: daemon.url, token: TOKEN });
  render(<VaultPage store={store} />);
  const tab = screen.queryByRole("tab", { name: "Backup" });
  expect(tab).not.toBeNull();
  await act(async () => {
    fireEvent.mouseDown(tab as HTMLElement, { button: 0 });
    fireEvent.click(tab as HTMLElement);
  });
  return { store, saved };
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

describe("cofre-ui: backup", () => {
  test("Exportar cofre saves a cofre.fdvault that holds the secrets and shows no value", async () => {
    const { store, saved } = await open();
    await store.secrets.add({ name: "deploy", type: "password", value: VALUE });
    await fill("Frase-senha", PASS);
    await fill("Confirmar frase-senha", PASS);
    await click("Exportar cofre");
    expect(saved).toHaveLength(1);
    expect(saved[0]?.name).toBe("cofre.fdvault");
    expect(
      screen.queryByText(
        "Cofre salvo como cofre.fdvault, onde você escolheu. Guarde a frase-senha: sem ela o backup não abre.",
      ),
    ).not.toBeNull();
    expect(saved[0]?.text).not.toContain(VALUE);
    const preview = await previewImport(
      await sourceVault(false),
      fromFdvault(saved[0]?.text ?? ""),
      PASS,
    );
    expect(preview.added.map((e) => e.meta.name)).toEqual(["deploy"]);
    expect(document.body.innerHTML).not.toContain(VALUE);
  });

  test("a short passphrase is refused with the reason and nothing is saved", async () => {
    const { saved } = await open();
    await fill("Frase-senha", "short");
    await fill("Confirmar frase-senha", "short");
    await click("Exportar cofre");
    expect(saved).toEqual([]);
    expect(
      screen.queryByText("A frase-senha precisa ter pelo menos 12 caracteres."),
    ).not.toBeNull();
  });

  test("a confirmation that differs is refused with the reason and nothing is saved", async () => {
    const { saved } = await open();
    await fill("Frase-senha", PASS);
    await fill("Confirmar frase-senha", `${PASS}x`);
    await click("Exportar cofre");
    expect(saved).toEqual([]);
    expect(screen.queryByText("As frases-senha não são iguais.")).not.toBeNull();
  });

  test("Exportar cofre stays off, and says why, until the passphrase is typed twice", async () => {
    await open();
    const button = () =>
      screen.getByRole("button", { name: "Exportar cofre" }) as HTMLButtonElement;
    const reason = "Digite a frase-senha e repita-a.";
    expect(button().disabled).toBe(true);
    expect(screen.queryByText(reason)).not.toBeNull();
    await fill("Frase-senha", PASS);
    expect(button().disabled).toBe(true);
    await fill("Confirmar frase-senha", PASS);
    expect(button().disabled).toBe(false);
    expect(screen.queryByText(reason)).toBeNull();
  });

  test("Enter in a passphrase exports: the fields and the button are one form", async () => {
    const { saved } = await open();
    await fill("Frase-senha", PASS);
    await fill("Confirmar frase-senha", PASS);
    const form = (screen.getByLabelText("Frase-senha") as HTMLElement).closest("form");
    expect(form).not.toBeNull();
    expect((screen.getByRole("button", { name: "Exportar cofre" }) as HTMLButtonElement).type).toBe(
      "submit",
    );
    await act(async () => {
      fireEvent.submit(form as HTMLFormElement);
    });
    await settle(() => saved.length === 1);
    expect(saved).toHaveLength(1);
  });

  test("the passphrase says how long it must be and what losing it means", async () => {
    await open();
    const field = screen.getByLabelText("Frase-senha") as HTMLElement;
    const help = document.getElementById(field.getAttribute("aria-describedby") ?? "");
    expect(help?.textContent).toBe("Pelo menos 12 caracteres. Sem ela o backup não abre.");
  });

  test("Importar cofre stays off, and says why, until the file's passphrase is typed", async () => {
    await open(await backupText());
    const button = () =>
      screen.getByRole("button", { name: "Importar cofre" }) as HTMLButtonElement;
    const reason = "Digite a frase-senha do arquivo.";
    expect(button().disabled).toBe(true);
    expect(screen.queryByText(reason)).not.toBeNull();
    await fill("Frase-senha do arquivo", PASS);
    expect(button().disabled).toBe(false);
    expect(screen.queryByText(reason)).toBeNull();
  });

  test("while the backup is being saved the button shows it is busy", async () => {
    const { platform } = memoryPlatform();
    let release: (() => void) | null = null;
    platform.saveFile = () =>
      new Promise<boolean>((resolve) => {
        release = () => resolve(true);
      });
    const store = new AppStore(platform, { baseDelayMs: 60_000, vaultWorkFactor: 4 });
    const daemon = legacyDaemon(cleanups);
    await store.roster.add({ name: "h", url: daemon.url, token: TOKEN });
    render(<VaultPage store={store} />);
    const tab = screen.getByRole("tab", { name: "Backup" });
    await act(async () => {
      fireEvent.mouseDown(tab, { button: 0 });
      fireEvent.click(tab);
    });
    await fill("Frase-senha", PASS);
    await fill("Confirmar frase-senha", PASS);
    await click("Exportar cofre");
    const busy = () =>
      screen.getByRole("button", { name: "Exportar cofre" }).getAttribute("aria-busy");
    expect(busy()).toBe("true");
    await act(async () => {
      (release as (() => void) | null)?.();
      await Bun.sleep(30);
    });
    expect(busy()).toBeNull();
  });

  test("Importar cofre previews new, same and conflicting secrets and changes nothing until Aplicar", async () => {
    const { store } = await open(await backupText());
    await fill("Frase-senha do arquivo", PASS);
    await click("Importar cofre");
    expect(screen.queryByText("Novos: 1")).not.toBeNull();
    expect(screen.queryByText("Iguais: 0")).not.toBeNull();
    expect(screen.queryByText("Conflitantes: 0")).not.toBeNull();
    expect(store.vault.list()).toEqual([]);
    await click("Aplicar");
    expect(store.getState().secrets.map((s) => s.name)).toEqual(["github"]);
    expect(await store.vault.value("shared-id")).toBe(VALUE);
    expect(screen.queryByText("Adicionados: 1, substituídos: 0, mantidos: 0.")).not.toBeNull();
  });

  test("a conflict keeps the local secret by default and takes the backup's when asked", async () => {
    const { store } = await open(await backupText());
    await store.vault.restore(
      {
        id: "shared-id",
        name: "github",
        type: "token",
        description: "",
        tags: [],
        createdAt: 1,
        lastUsedAt: null,
        allowedHosts: ["local"],
      },
      "local-value",
    );
    await fill("Frase-senha do arquivo", PASS);
    await click("Importar cofre");
    expect(screen.queryByText("Conflitantes: 1")).not.toBeNull();
    const conflicts = screen.getByRole("list", { name: "Segredos em conflito" });
    expect([...conflicts.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["github"]);
    await click("Aplicar");
    expect(await store.vault.value("shared-id")).toBe("local-value");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    // The panel forgets the passphrase once the import is applied.
    await fill("Frase-senha do arquivo", PASS);
    await click("Importar cofre");
    const replace = screen.queryByLabelText("Substituir pelo backup");
    expect(replace).not.toBeNull();
    await act(async () => {
      fireEvent.click(replace as HTMLElement);
    });
    await click("Aplicar");
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain(
      "Substituir github no cofre pelos do backup? Os valores atuais se perdem.",
    );
    expect(await store.vault.value("shared-id")).toBe("local-value");
    await click("Substituir segredos");
    expect(await store.vault.value("shared-id")).toBe(VALUE);
  });

  test("Cancelar no aviso de substituição não muda o cofre e deixa a prévia aberta", async () => {
    const { store } = await open(await backupText());
    await store.vault.restore(
      {
        id: "shared-id",
        name: "github",
        type: "token",
        description: "",
        tags: [],
        createdAt: 1,
        lastUsedAt: null,
        allowedHosts: ["local"],
      },
      "local-value",
    );
    await fill("Frase-senha do arquivo", PASS);
    await click("Importar cofre");
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Substituir pelo backup"));
    });
    await click("Aplicar");
    await click("Cancelar");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(await store.vault.value("shared-id")).toBe("local-value");
    expect(screen.queryByText("Conflitantes: 1")).not.toBeNull();
  });

  test("a wrong passphrase is refused with the reason and nothing is imported", async () => {
    const { store } = await open(await backupText());
    await fill("Frase-senha do arquivo", "another passphrase");
    await click("Importar cofre");
    expect(
      screen.queryByText(
        "Não foi possível ler o arquivo. Confira a frase-senha; um arquivo alterado também é recusado.",
      ),
    ).not.toBeNull();
    expect(store.vault.list()).toEqual([]);
  });

  test("a cancelled file dialog shows neither a preview nor an error", async () => {
    await open(null);
    await fill("Frase-senha do arquivo", PASS);
    await click("Importar cofre");
    expect(screen.queryByText(/^Novos:/)).toBeNull();
    expect(screen.queryByText(/Não foi possível ler/)).toBeNull();
  });

  test("going back to Manter o que está no cofre after choosing the backup keeps the local secret", async () => {
    const { store } = await open(await backupText());
    await store.vault.restore(
      {
        id: "shared-id",
        name: "github",
        type: "token",
        description: "",
        tags: [],
        createdAt: 1,
        lastUsedAt: null,
        allowedHosts: ["local"],
      },
      "local-value",
    );
    await fill("Frase-senha do arquivo", PASS);
    await click("Importar cofre");
    for (const label of ["Substituir pelo backup", "Manter o que está no cofre"]) {
      await act(async () => {
        fireEvent.click(screen.queryByLabelText(label) as HTMLElement);
      });
    }
    await click("Aplicar");
    expect(await store.vault.value("shared-id")).toBe("local-value");
  });
});

/** The vault entry a backup shares with `sourceVault`, so the restore sees one conflict. */
const LOCAL_GITHUB: SecretMeta = {
  id: "shared-id",
  name: "github",
  type: "token",
  description: "",
  tags: [],
  createdAt: 1,
  lastUsedAt: null,
  allowedHosts: ["local"],
};

const alertText = () => screen.queryByRole("alert")?.textContent ?? "";

// Issue #4346: the Vault > Backup tab behaves as Settings > Back up everything does.
describe("cofre-ui: backup, focus, announcements and a failed restore", () => {
  test("the preview is named and takes the focus when it appears", async () => {
    await open(await backupText());
    await fill("Frase-senha do arquivo", PASS);
    await click("Importar cofre");
    const preview = screen.queryByRole("region", { name: "Prévia do backup" });
    expect({ shown: preview !== null, focused: document.activeElement === preview }).toEqual({
      shown: true,
      focused: true,
    });
  });

  test("with a conflict, the choice has a legend, its radios are hit controls and a name wraps", async () => {
    const { store } = await open(await backupText());
    await store.vault.restore(LOCAL_GITHUB, "local-value");
    await fill("Frase-senha do arquivo", PASS);
    await click("Importar cofre");
    const radios = ["Manter o que está no cofre", "Substituir pelo backup"].map((label) =>
      screen.queryByLabelText(label),
    );
    const item = screen.getByRole("list", { name: "Segredos em conflito" }).querySelector("li");
    expect({
      legend: screen.queryByRole("group", { name: "Quando for diferente" }) !== null,
      hit: radios.map((radio) => radio?.classList.contains("hit-control")),
      wraps: item?.classList.contains("[overflow-wrap:anywhere]"),
    }).toEqual({ legend: true, hit: [true, true], wraps: true });
  });

  test("a restore that fails says so in an alert, ends the busy state and puts the focus on the file passphrase", async () => {
    const { store } = await open(await backupText());
    store.secrets.applyImport = async () => {
      throw new Error("disk full");
    };
    await fill("Frase-senha do arquivo", PASS);
    await click("Importar cofre");
    await click("Aplicar");
    const field = screen.queryByLabelText("Frase-senha do arquivo");
    expect({
      alert: alertText(),
      previewGone: screen.queryByRole("region", { name: "Prévia do backup" }) === null,
      focused: field !== null && document.activeElement === field,
    }).toEqual({
      alert:
        "A importação parou com um erro. Alguns segredos podem já estar no cofre: confira a lista antes de tentar de novo.",
      previewGone: true,
      focused: true,
    });
  });

  test("a restore that fails halfway still refreshes the secrets list with what got in", async () => {
    const { store } = await open(await backupText());
    const restore = store.vault.restore.bind(store.vault);
    store.vault.restore = async (meta, value) => {
      await restore(meta, value);
      throw new Error("disk full");
    };
    await fill("Frase-senha do arquivo", PASS);
    await click("Importar cofre");
    await click("Aplicar");
    expect(store.getState().secrets.map((secret) => secret.name)).toEqual(["github"]);
  });

  test("a wrong passphrase is an alert, and editing the field clears it", async () => {
    await open(await backupText());
    await fill("Frase-senha do arquivo", "another passphrase");
    await click("Importar cofre");
    const said = alertText();
    await fill("Frase-senha do arquivo", "another passphrase!");
    expect({ said: said.startsWith("Não foi possível ler o arquivo"), after: alertText() }).toEqual(
      { said: true, after: "" },
    );
  });

  test("an export refused for its passphrase is an alert, and editing either field clears it", async () => {
    await open();
    await fill("Frase-senha", "short");
    await fill("Confirmar frase-senha", "short");
    await click("Exportar cofre");
    const said = alertText();
    await fill("Confirmar frase-senha", "shorter");
    expect({ said, after: alertText() }).toEqual({
      said: "A frase-senha precisa ter pelo menos 12 caracteres.",
      after: "",
    });
  });

  test("pressing Aplicar twice while the restore runs applies the preview once and shows it is busy", async () => {
    const { store } = await open(await backupText());
    let calls = 0;
    let release: (() => void) | null = null;
    store.secrets.applyImport = () => {
      calls += 1;
      return new Promise((resolve) => {
        release = () => resolve({ added: 1, overwritten: 0, skipped: 0 });
      });
    };
    await fill("Frase-senha do arquivo", PASS);
    await click("Importar cofre");
    await click("Aplicar");
    const busy = screen.queryByRole("button", { name: "Aplicar" })?.getAttribute("aria-busy");
    await click("Aplicar");
    await act(async () => {
      (release as (() => void) | null)?.();
    });
    await uiIdle();
    expect({ calls, busy }).toEqual({ calls: 1, busy: "true" });
  });

  test("a restore that succeeds is announced as a status and the focus returns to the file passphrase", async () => {
    await open(await backupText());
    await fill("Frase-senha do arquivo", PASS);
    await click("Importar cofre");
    await click("Aplicar");
    const field = screen.queryByLabelText("Frase-senha do arquivo");
    expect({
      announced: screen
        .queryAllByRole("status")
        .some((node) => node.textContent === "Adicionados: 1, substituídos: 0, mantidos: 0."),
      focused: field !== null && document.activeElement === field,
    }).toEqual({ announced: true, focused: true });
  });
});
