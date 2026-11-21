import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform, TOKEN } from "../fixtures.ts";
import { legacyDaemon } from "../legacy-daemon.ts";
import { settleMaybe } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { VaultPage } = await import("../../src/features/vault/page.tsx");
const { TContext } = await import("../../src/i18n/context.tsx");
const { translator } = await import("../../src/i18n/index.ts");
const { addedSecret } = await import("./added-secret.ts");

setDefaultTimeout(20_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const VALUE = "missing-value-0123456789";
const TEXT = {
  en: "github has no value in the system vault. Remove the secret and add it again.",
  "pt-BR": "github não tem valor no cofre do sistema. Remova o segredo e adicione-o de novo.",
} as const;
const WORDS = {
  en: {
    reveal: "Reveal github",
    copy: "Copy github",
    prompt: "Type reveal to confirm",
    word: "reveal",
    ok: "Reveal",
  },
  "pt-BR": {
    reveal: "Revelar github",
    copy: "Copiar github",
    prompt: "Digite revelar para confirmar",
    word: "revelar",
    ok: "Revelar",
  },
} as const;

type Lang = keyof typeof TEXT;

/** The page over a store whose keyring is told how to answer; the clipboard is a list. */
async function open(
  lang: Lang,
  keyring: { get: () => Promise<string | null>; copy?: () => Promise<void> },
) {
  const { platform } = memoryPlatform(false, lang);
  const copied: string[] = [];
  platform.copyText = async (text) => {
    await keyring.copy?.();
    copied.push(text);
  };
  const store = new AppStore(platform, { baseDelayMs: 60_000 });
  const daemon = legacyDaemon(cleanups);
  await store.roster.add({ name: "h", url: daemon.url, token: TOKEN });
  await addedSecret(store, { name: "github", type: "password", value: VALUE });
  platform.vault.get = keyring.get;
  store.i18n.setLang(lang);
  render(
    <TContext.Provider value={translator(lang)}>
      <VaultPage store={store} />
    </TContext.Provider>,
  );
  return { store, copied };
}

const click = async (name: string) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};

async function confirmReveal(lang: Lang) {
  await click(WORDS[lang].reveal);
  const field = screen.queryByLabelText(WORDS[lang].prompt);
  expect(field).not.toBeNull();
  await act(async () => {
    fireEvent.change(field as HTMLElement, { target: { value: WORDS[lang].word } });
  });
  await click(WORDS[lang].ok);
}

const errors = (store: InstanceType<typeof AppStore>) =>
  store
    .getState()
    .notices.filter((n) => n.kind === "error")
    .map((n) => n.text);

for (const lang of ["en", "pt-BR"] as const) {
  describe(`vault: a secret with no value in the keyring is told, not skipped (#3603, ${lang})`, () => {
    test("Reveal says the value is missing and what to do, shows nothing and keeps the focus on the row", async () => {
      const { store } = await open(lang, { get: async () => null });
      await confirmReveal(lang);
      await settleMaybe(() => errors(store).length > 0, 600);
      expect(errors(store)).toEqual([TEXT[lang]]);
      expect(screen.queryByText(VALUE)).toBeNull();
      const button = screen.queryByRole("button", { name: WORDS[lang].reveal });
      expect(button).not.toBeNull();
      await settleMaybe(() => document.activeElement === button, 600);
      expect(document.activeElement === button).toBe(true);
    });

    test("Copy says the same and writes nothing to the clipboard", async () => {
      const { store, copied } = await open(lang, { get: async () => null });
      await click(WORDS[lang].copy);
      await settleMaybe(() => errors(store).length > 0, 600);
      expect(errors(store)).toEqual([TEXT[lang]]);
      expect(copied).toEqual([]);
    });
  });
}

describe("vault: a keyring that refuses and a clipboard that refuses are told as they are (#3603)", () => {
  test("a rejected read is told with a fixed text that names the secret, never the keyring's own", async () => {
    const { store } = await open("en", {
      get: async () => {
        throw new Error(
          "Ambiguous(user=key-7f3a, service=/org/freedesktop/secrets/collection/login)",
        );
      },
    });
    await confirmReveal("en");
    await click("Copy github");
    await settleMaybe(() => errors(store).length > 0, 600);
    expect(errors(store)).toEqual([
      "The system vault did not give the value of github. Try again.",
    ]);
    expect(store.getState().error).toBe(
      "The system vault did not give the value of github. Try again.",
    );
  });

  test("a clipboard that fails for a secret that has a value is not told as a missing value", async () => {
    const { store } = await open("en", {
      get: async () => VALUE,
      copy: async () => {
        throw new Error("clipboard denied");
      },
    });
    await click("Copy github");
    await settleMaybe(() => errors(store).length > 0, 600);
    expect(errors(store)).toEqual(["clipboard denied"]);
  });
});
