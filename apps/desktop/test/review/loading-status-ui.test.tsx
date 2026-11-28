import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { translator } from "../../src/i18n/index.ts";
import { liveScreen, registerDom } from "../dom.ts";
import { fakeHostStore, onWire } from "../fake-host.ts";
import { settleMaybe } from "../wait.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { TContext } = await import("../../src/i18n/context.tsx");
const { ChangesPanel } = await import("../../src/features/review/changes-panel.tsx");
const { FileEditor } = await import("../../src/features/review/file-editor.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

type Lang = "en" | "pt-BR";
const WORDS = {
  en: { changes: "Reading the changes…", editor: "Opening the file…" },
  "pt-BR": { changes: "Lendo as mudanças…", editor: "Abrindo o arquivo…" },
} as const;

/** A host that never answers the command: the screen stays in its first read. */
const never = onWire(() => new Promise<unknown>(() => {}));

describe("the first read of the Review screen is a status the page announces (#4516)", () => {
  for (const lang of ["en", "pt-BR"] as const) {
    test(`${lang}: the Changes panel's first read is a named status`, async () => {
      // The panel's own seams, as the other panel tests fake them: its first read never answers.
      const store = {
        hostRequest: () => new Promise(() => {}),
        hostCommand: async () => ({ comments: [] }),
        watchChanges: () => () => {},
        system: { canOpenPaths: () => false, copyText: async () => {} },
        later: () => () => {},
        now: () => Date.now(),
        success: () => {},
      } as never;
      render(
        <TContext.Provider value={translator(lang)}>
          <ChangesPanel store={store} hostId="h" target="session:c1" />
        </TContext.Provider>,
      );
      expect(
        await settleMaybe(
          () => screen.queryByRole("status", { name: WORDS[lang].changes }) !== null,
        ),
      ).toBe(true);
    });

    test(`${lang}: the file editor's opening is a named status`, async () => {
      const { store } = await fakeHostStore({ "file.read": never }, { language: lang });
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
      expect(
        await settleMaybe(
          () => screen.queryByRole("status", { name: WORDS[lang].editor }) !== null,
        ),
      ).toBe(true);
    });
  }
});
