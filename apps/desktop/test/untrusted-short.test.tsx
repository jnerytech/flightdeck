import { afterEach, describe, expect, test } from "bun:test";
import { en } from "../src/i18n/en.ts";
import { translator } from "../src/i18n/index.ts";
import { ptBR } from "../src/i18n/pt-BR.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { settle } from "./wait.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { UntrustedNotice } = await import("../src/components/projects/untrusted-notice.tsx");
const { ShortArea, SessionPane } = await import("../src/components/session/parts.tsx");

afterEach(() => cleanup());

/** Whether `check` comes true within the wait. */
const seen = (check: () => boolean) =>
  settle(check).then(
    () => true,
    () => false,
  );

/** A host that says the folder is not trusted. */
function notice(lang: "en" | "pt-BR", short: boolean) {
  const store = {
    i18n: { t: translator(lang) },
    hostCommand: async () => ({ items: [{ trusted: false }] }),
  } as never;
  render(
    <ShortArea.Provider value={short}>
      <UntrustedNotice store={store} hostId="h" announced cwd="/p" onReview={() => undefined} />
    </ShortArea.Provider>,
  );
}

for (const [lang, dict] of [
  ["en", en],
  ["pt-BR", ptBR],
] as const) {
  const trust = dict.projectPage.trust;
  describe(`untrusted-short (${lang}): the not-trusted notice in a short session area (issue #422)`, () => {
    test("in a short area it is one short line with Review; the full list waits on the project page", async () => {
      notice(lang, true);
      expect(
        await seen(() => screen.queryByText(trust.sessionNoticeShort, { exact: false }) !== null),
      ).toBe(true);
      expect(screen.queryByText(trust.sessionNotice, { exact: false })).toBeNull();
      expect(screen.queryByRole("button", { name: trust.review })).not.toBeNull();
    });

    // Issue #488: while a request waits for the person the notice is its one line too.
    test("with a request waiting it is the one short line, even in a tall area", async () => {
      const store = {
        i18n: { t: translator(lang) },
        hostCommand: async () => ({ items: [{ trusted: false }] }),
      } as never;
      render(
        <SessionPane waiting>
          <UntrustedNotice store={store} hostId="h" announced cwd="/p" />
        </SessionPane>,
      );
      expect(
        await seen(() => screen.queryByText(trust.sessionNoticeShort, { exact: false }) !== null),
      ).toBe(true);
    });

    test("in a tall area it says everything that did not load, as before", async () => {
      notice(lang, false);
      expect(
        await seen(() => screen.queryByText(trust.sessionNotice, { exact: false }) !== null),
      ).toBe(true);
      expect(screen.queryByText(trust.sessionNoticeShort, { exact: false })).toBeNull();
    });
  });
}
