import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { translator } from "../../src/i18n/index.ts";
import { liveScreen, registerDom } from "../dom.ts";
import { fakeHostStore, onWire } from "../fake-host.ts";
import { settleMaybe, uiIdle } from "../wait.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { TContext } = await import("../../src/i18n/context.tsx");
const { RequestError } = await import("../../src/features/hosts/host-connection.ts");
const { FileSessions } = await import("../../src/features/review/file-sessions.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

type Lang = "en" | "pt-BR";
const WORDS = {
  en: {
    open: "Sessions that touched src/a.ts",
    loading: "Reading the sessions…",
    failed: "Could not read the sessions.",
    retry: "Try again",
    none: "No session recorded an edit to this file.",
  },
  "pt-BR": {
    open: "Sessões que mexeram em src/a.ts",
    loading: "Lendo as sessões…",
    failed: "Não consegui ler as sessões.",
    retry: "Tentar de novo",
    none: "Nenhuma sessão registrou edição neste arquivo.",
  },
} as const;

const session = {
  claudeSessionId: "s1",
  edits: 2,
  firstAt: "2026-11-01T10:00:00.000Z",
  lastAt: "2026-11-01T11:00:00.000Z",
  title: "Fix the parser",
};

/** The popover of `src/a.ts`, opened; `answers` are the host's replies to `files.sessions`, in order. */
async function opened(
  lang: Lang,
  answers: Array<Error | Promise<unknown> | { sessions: unknown[] }>,
) {
  const queue = [...answers];
  const { store } = await fakeHostStore(
    { "files.sessions": onWire(async () => queue.shift() ?? { sessions: [] }) },
    { language: lang },
  );
  render(
    <TContext.Provider value={translator(lang)}>
      <FileSessions store={store} hostId="h" root="/repo" path="src/a.ts" />
    </TContext.Provider>,
  );
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: WORDS[lang].open }));
  });
}

describe("the file's sessions popover tells reading, failing and none apart (#4227)", () => {
  for (const lang of ["en", "pt-BR"] as const) {
    const w = WORDS[lang];
    test(`${lang}: while the read is out a loading line shows, and no empty text`, async () => {
      let release = () => {};
      const held = new Promise<unknown>((resolve) => {
        release = () => resolve({ sessions: [session] });
      });
      await opened(lang, [held]);
      expect(
        await settleMaybe(() => screen.queryByRole("status", { name: w.loading }) !== null),
      ).toBe(true);
      expect(screen.queryByText(w.none)).toBeNull();
      await act(async () => release());
      expect(await settleMaybe(() => screen.queryByText("Fix the parser") !== null)).toBe(true);
      expect(screen.queryByRole("status", { name: w.loading })).toBeNull();
    });

    test(`${lang}: a refused read shows the failure and Try again, never the empty text; Try again lists them`, async () => {
      await opened(lang, [new RequestError("unavailable", "no index"), { sessions: [session] }]);
      expect(await settleMaybe(() => screen.queryByText(w.failed) !== null)).toBe(true);
      expect(screen.queryByText(w.none)).toBeNull();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: w.retry }));
      });
      expect(await settleMaybe(() => screen.queryByText("Fix the parser") !== null)).toBe(true);
      expect(screen.queryByText(w.failed)).toBeNull();
    });

    test(`${lang}: a host that answers with none says so`, async () => {
      await opened(lang, [{ sessions: [] }]);
      await uiIdle();
      expect(await settleMaybe(() => screen.queryByText(w.none) !== null)).toBe(true);
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByRole("status", { name: w.loading })).toBeNull();
    });
  }
});
