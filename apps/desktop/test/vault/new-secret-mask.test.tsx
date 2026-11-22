import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform, TOKEN } from "../fixtures.ts";
import { legacyDaemon } from "../legacy-daemon.ts";
import { settle, uiIdle } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { VaultPage } = await import("../../src/features/vault/page.tsx");
const { TContext } = await import("../../src/i18n/context.tsx");
const { translator } = await import("../../src/i18n/index.ts");

setDefaultTimeout(20_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const VALUE = "mask-test-value-0123456789";
const WORDS = {
  en: {
    create: "New secret",
    value: "Value",
    type: "Type",
    save: "Save",
    show: "Show value",
  },
  "pt-BR": {
    create: "Novo segredo",
    value: "Valor",
    type: "Tipo",
    save: "Guardar",
    show: "Mostrar valor",
  },
} as const;
type Lang = keyof typeof WORDS;

/** The page over an empty vault, with the New secret form open. */
async function openForm(lang: Lang = "pt-BR") {
  const store = new AppStore(memoryPlatform(false, lang).platform, { baseDelayMs: 60_000 });
  const daemon = legacyDaemon(cleanups);
  await store.roster.add({ name: "box", url: daemon.url, token: TOKEN });
  store.i18n.setLang(lang);
  render(
    <TContext.Provider value={translator(lang)}>
      <VaultPage store={store} />
    </TContext.Provider>,
  );
  const open = screen.queryAllByRole("button", { name: WORDS[lang].create })[0] as HTMLElement;
  await act(async () => {
    fireEvent.click(open);
  });
  await uiIdle();
  return { store, words: WORDS[lang] };
}

const change = async (label: string, value: string) => {
  await act(async () => {
    fireEvent.change(screen.queryByLabelText(label) as HTMLElement, { target: { value } });
  });
};
const press = async (name: string) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};
/** What the Value field is: its element, its input type, and what it holds. */
const field = (label: string) => {
  const el = screen.queryByLabelText(label) as HTMLInputElement | HTMLTextAreaElement | null;
  return { tag: el?.tagName, type: (el as HTMLInputElement | null)?.type, value: el?.value };
};

describe("cofre-ui: the New secret Value hides what is typed for a password or a token (#3942)", () => {
  test.each(["en", "pt-BR"] as const)("%s: a Password value is a masked input", async (lang) => {
    const { words } = await openForm(lang);
    await change(words.value, VALUE);
    expect(field(words.value)).toEqual({ tag: "INPUT", type: "password", value: VALUE });
  });

  test("a Token value is masked too", async () => {
    const { words } = await openForm();
    await change(words.type, "token");
    await change(words.value, VALUE);
    expect(field(words.value)).toEqual({ tag: "INPUT", type: "password", value: VALUE });
  });

  test("an SSH key and environment variables keep the multi-line box", async () => {
    const { words } = await openForm();
    const seen: Array<string | undefined> = [];
    for (const type of ["ssh-key", "env"]) {
      await change(words.type, type);
      seen.push(field(words.value).tag);
    }
    expect(seen).toEqual(["TEXTAREA", "TEXTAREA"]);
  });

  test.each(["en", "pt-BR"] as const)(
    "%s: Show reveals the value only while it is on",
    async (lang) => {
      const { words } = await openForm(lang);
      await change(words.value, VALUE);
      const state = () => [
        field(words.value).type,
        screen.queryByRole("button", { name: words.show })?.getAttribute("aria-pressed"),
      ];
      const before = state();
      await press(words.show);
      const shown = state();
      await press(words.show);
      expect([before, shown, state()]).toEqual([
        ["password", "false"],
        ["text", "true"],
        ["password", "false"],
      ]);
    },
  );

  test("the typed value stays when the type changes, and the masking follows the type", async () => {
    const { words } = await openForm();
    await change(words.value, VALUE);
    await change(words.type, "env");
    const multi = field(words.value);
    await change(words.type, "password");
    expect([multi, field(words.value)]).toEqual([
      { tag: "TEXTAREA", type: "textarea", value: VALUE },
      { tag: "INPUT", type: "password", value: VALUE },
    ]);
  });

  test("Show goes off again when the type changes", async () => {
    const { words } = await openForm();
    await change(words.value, VALUE);
    await press(words.show);
    await change(words.type, "env");
    await change(words.type, "token");
    expect(field(words.value).type).toBe("password");
  });

  test("a masked value is stored exactly as typed, with its spaces", async () => {
    const { store, words } = await openForm();
    const typed = `  ${VALUE} `;
    await change("Nome", "github");
    await change(words.value, typed);
    await press(words.save);
    await settle(() => store.getState().secrets.length === 1);
    const [meta] = store.getState().secrets;
    expect(meta ? await store.vault.value(meta.id) : null).toBe(typed);
  });

  test("the masked box asks the browser not to save or fill it", async () => {
    const { words } = await openForm();
    const el = screen.queryByLabelText(words.value) as HTMLInputElement;
    expect(el.autocomplete).toBe("new-password");
  });

  test("a multi-line value is not carried into a masked box, which would join its lines on save", async () => {
    const { store, words } = await openForm();
    await change("Nome", "pem");
    await change(words.type, "ssh-key");
    await change(words.value, "line one\nline two");
    await change(words.type, "token");
    const kept = field(words.value).value;
    await change(words.value, "one-line-token");
    await press(words.save);
    await settle(() => store.getState().secrets.length === 1);
    const [meta] = store.getState().secrets;
    expect({ kept, stored: meta ? await store.vault.value(meta.id) : null }).toEqual({
      kept: "",
      stored: "one-line-token",
    });
  });
});
