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
  en: {
    field: "Text of src/a.ts",
    save: "Save",
    overwrite: "Overwrite with my version",
    conflict: "The file changed on disk after it was opened.",
  },
  "pt-BR": {
    field: "Texto de src/a.ts",
    save: "Salvar",
    overwrite: "Sobrescrever com a minha versão",
    conflict: "O arquivo mudou no disco depois de aberto.",
  },
} as const;

/** The editor of `src/a.ts`, opened over a host that reads the file and answers each write with `write`. */
async function opened(
  lang: Lang,
  write: () => Promise<unknown>,
  read: () => Promise<unknown> = async () => ({ text: "const total = a + b;\n", hash: "h1" }),
) {
  const { store, calls } = await fakeHostStore(
    {
      "file.read": onWire(read),
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

  for (const lang of ["en", "pt-BR"] as const) {
    test(`${lang}: an overwrite whose re-read is refused keeps the editor and the conflict choices`, async () => {
      let reads = 0;
      const { words } = await opened(
        lang,
        async () => new RequestError("file_conflict", "changed"),
        async () => {
          reads += 1;
          if (reads > 1) return new RequestError("unavailable", "disk gone");
          return { text: "const total = a + b;\n", hash: "h1" };
        },
      );
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: words.save }));
      });
      expect(await settleMaybe(() => screen.queryByText(words.conflict) !== null)).toBe(true);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: words.overwrite }));
      });
      expect(
        await settleMaybe(() => (screen.queryByRole("alert")?.textContent ?? "").includes("disk gone")),
      ).toBe(true);
      expect(screen.queryByRole("textbox", { name: words.field }) !== null).toBe(true);
      expect(screen.queryByRole("button", { name: words.overwrite }) !== null).toBe(true);
    });
  }
});
