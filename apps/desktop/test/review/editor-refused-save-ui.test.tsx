import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { translator } from "../../src/i18n/index.ts";
import { liveScreen, registerDom } from "../dom.ts";
import { fakeHostStore, onWire } from "../fake-host.ts";
import { settleMaybe } from "../wait.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { TContext } = await import("../../src/i18n/context.tsx");
const { RequestError } = await import("../../src/features/hosts/host-connection.ts");
const { FileEditor } = await import("../../src/features/review/file-editor.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

type Lang = "en" | "pt-BR";
const WORDS = {
  en: { field: "Text of src/a.ts", save: "Save", overwrite: "Overwrite with my version" },
  "pt-BR": {
    field: "Texto de src/a.ts",
    save: "Salvar",
    overwrite: "Sobrescrever com a minha versão",
  },
} as const;

/** The editor of `src/a.ts`, opened over a host that reads the file and answers each write with `write`. */
async function opened(lang: Lang, write: () => Promise<unknown>) {
  const { store, calls } = await fakeHostStore(
    {
      "file.read": onWire(async () => ({ text: "const total = a + b;\n", hash: "h1" })),
      "file.write": onWire(write),
    },
    { language: lang },
  );
  render(
    <TContext.Provider value={translator(lang)}>
      <FileEditor
        store={store}
        hostId="h"
        target="session:c1"
        path="src/a.ts"
        onSaved={() => {}}
        onClose={() => {}}
      />
    </TContext.Provider>,
  );
  const words = WORDS[lang];
  expect(
    await settleMaybe(() => screen.queryByRole("textbox", { name: words.field }) !== null),
  ).toBe(true);
  return { calls, words };
}

describe("a save the host refuses keeps the editor and what was written in it (#4515)", () => {
  for (const lang of ["en", "pt-BR"] as const) {
    test(`${lang}: the text stays in the editor, the reason shows as an alert and Save can be pressed again`, async () => {
      const { calls, words } = await opened(
        lang,
        async () => new RequestError("unavailable", "disk full"),
      );
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: words.save }));
      });
      expect(await settleMaybe(() => calls.some((c) => c.type === "file.write"))).toBe(true);
      expect(
        await settleMaybe(() =>
          (screen.queryByRole("alert")?.textContent ?? "").includes("disk full"),
        ),
      ).toBe(true);
      expect(screen.queryByRole("textbox", { name: words.field }) !== null).toBe(true);
      expect(screen.queryByRole("button", { name: words.save }) !== null).toBe(true);
    });
  }
});
