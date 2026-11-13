import { afterEach, describe, expect, jest, test } from "bun:test";
import { en } from "../../src/i18n/en.ts";
import { translator } from "../../src/i18n/index.ts";
import { ptBR } from "../../src/i18n/pt-BR.ts";
import { liveScreen, registerDom } from "../dom.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { TContext } = await import("../../src/i18n/context.tsx");
const { HostTerminal } = await import("../../src/features/hosts/host-terminal.tsx");
const { RequestError } = await import("../../src/features/hosts/host-connection.ts");

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

const REFRESH_MS = 1000;
const ONE = { terminalId: "t1", command: "bash", cwd: "/srv/app", exitCode: null };
/** What the screen says when no read of the list ever worked (issue #2587). */
const UNREADABLE = {
  en: "Could not read the terminals of this host.",
  "pt-BR": "Não foi possível ler os terminais deste host.",
} as const;

type Read = { ok: object[] } | "fail" | "refuse" | "pending";

/** The page of an online host whose list answers the given reads in order, the last one for good. */
async function openPage(lang: "en" | "pt-BR", reads: Read[]) {
  jest.useFakeTimers();
  let next = 0;
  const store = {
    terminals: {
      host: () => ({
        list: async () => {
          const read = reads[Math.min(next++, reads.length - 1)];
          if (read === "fail") throw new RequestError("offline", "connection lost");
          // The host answered: terminals are off there (a command it refuses, not a lost link).
          if (read === "refuse") throw new RequestError("feature_off", "terminals are off");
          if (read === "pending") return new Promise<never>(() => {});
          return read?.ok ?? [];
        },
      }),
      open: async () => {},
    },
    hostTabs: { show: () => {} },
    hostCommand: async () => {},
    reloadHostInfo: async () => {},
  };
  const host = {
    id: "h1",
    name: "pc",
    status: "online",
    hostInfo: { terminal: true, features: ["terminal"] },
  };
  render(
    <TContext.Provider value={translator(lang)}>
      <HostTerminal store={store as never} host={host as never} />
    </TContext.Provider>,
  );
  // The first read, then every refresh the test asks for.
  await act(async () => {});
  return {
    refresh: () =>
      act(async () => {
        jest.advanceTimersByTime(REFRESH_MS);
      }),
  };
}

for (const [lang, t] of [
  ["en", en],
  ["pt-BR", ptBR],
] as const) {
  const attach = () =>
    screen.queryByRole("button", { name: t.hostTerminal.attach.replace("{cwd}", ONE.cwd) });
  const none = () => screen.queryByText(t.hostTerminal.none);
  const unreadable = () => screen.queryByText(UNREADABLE[lang]);

  describe(`host-terminal-list (${lang}): a failed read of the terminals is not an empty list (issue #2587)`, () => {
    test("when no read ever worked, it says the list could not be read, not that nothing is open", async () => {
      await openPage(lang, ["fail"]);
      expect(unreadable() !== null).toBe(true);
      expect(none() === null).toBe(true);
    });

    test("a failed read after a good one keeps the last list and shows no error", async () => {
      const page = await openPage(lang, [{ ok: [ONE] }, "fail"]);
      expect(attach() !== null).toBe(true);
      await page.refresh();
      expect(attach() !== null).toBe(true);
      expect(unreadable() === null).toBe(true);
      expect(none() === null).toBe(true);
    });

    test("a read the host refuses is its answer: no terminal is open, even after a list was shown", async () => {
      const page = await openPage(lang, [{ ok: [ONE] }, "refuse"]);
      expect(attach() !== null).toBe(true);
      await page.refresh();
      expect(attach() === null).toBe(true);
      expect(none() !== null).toBe(true);
      expect(unreadable() === null).toBe(true);
    });

    test("a good read after the failed first one replaces the message with the list", async () => {
      const page = await openPage(lang, ["fail", { ok: [ONE] }]);
      expect(unreadable() !== null).toBe(true);
      await page.refresh();
      expect(attach() !== null).toBe(true);
      expect(unreadable() === null).toBe(true);
    });

    test("before the first read answers it says neither that nothing is open nor that the list is unreadable", async () => {
      await openPage(lang, ["pending"]);
      expect(unreadable() === null).toBe(true);
      expect(none() === null).toBe(true);
    });

    test("an empty list the host returned still reads as no terminal open", async () => {
      await openPage(lang, [{ ok: [] }]);
      expect(none() !== null).toBe(true);
      expect(unreadable() === null).toBe(true);
    });

    test("a failed read after the host returned an empty list keeps saying no terminal is open", async () => {
      const page = await openPage(lang, [{ ok: [] }, "fail"]);
      await page.refresh();
      expect(none() !== null).toBe(true);
      expect(unreadable() === null).toBe(true);
    });
  });
}
