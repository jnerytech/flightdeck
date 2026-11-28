import { afterEach, describe, expect, test } from "bun:test";
import { en } from "../../src/i18n/en.ts";
import { ptBR } from "../../src/i18n/pt-BR.ts";
import { liveScreen, registerDom } from "../dom.ts";
import { settleMaybe, uiIdle } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { GithubPanel } = await import("../../src/features/hosts/github-panel.tsx");
const { TContext } = await import("../../src/i18n/context.tsx");
const { AppStore } = await import("../../src/lib/app-store.ts");
const { memoryPlatform } = await import("../fixtures.ts");

afterEach(cleanup);

const STATUS = {
  installed: true,
  loggedIn: false,
  login: null,
  source: null,
  scopes: [] as string[],
};
const SIGNED_IN = { ...STATUS, loggedIn: true, login: "octocat", source: "keyring" };

/** What each request type comes to: a value, `null` (the host refused), or "hold" (never answers). */
type Answers = Partial<Record<string, unknown>>;

/** The panel over a host that answers as `answers` says; `statuses` are the successive `github.status`. */
async function open(language: "en" | "pt-BR", answers: Answers, statuses: unknown[]) {
  const real = new AppStore(memoryPlatform(false, language).platform, { baseDelayMs: 600_000 });
  real.i18n.start();
  const asked: string[] = [];
  let reads = 0;
  const store = {
    hostCommand: async (_host: string, type: string) => {
      asked.push(type);
      if (type === "github.status") {
        const next = statuses[Math.min(reads++, statuses.length - 1)];
        if (next === "hold") return await new Promise(() => {});
        return next;
      }
      return answers[type] ?? null;
    },
    githubTicker: () => () => {},
    refreshSetup: async () => {},
    system: { copyText: async () => {} },
    openLink: () => {},
  };
  await act(async () => {
    render(
      <TContext.Provider value={real.i18n.t}>
        <GithubPanel store={store as never} host={{ id: "h1", name: "alfa" } as never} />
      </TContext.Provider>,
    );
  });
  return { asked };
}

const press = async (name: string) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};

const CODE = { code: "ABCD-1234", url: "https://github.com/login/device" };

for (const [language, t] of [
  ["en", en],
  ["pt-BR", ptBR],
] as const) {
  describe(`the host's GitHub panel says what happened (${language}, #4457)`, () => {
    test("before the host answers, it says it is reading", async () => {
      await open(language, {}, ["hold"]);
      await uiIdle();
      expect(screen.queryByRole("status", { name: t.github.loading })).not.toBeNull();
    });

    test("a refused read is an alert with a way to read again, which reads again", async () => {
      const { asked } = await open(language, {}, [null, STATUS]);
      await settleMaybe(() => screen.queryByText(t.github.failed) !== null, 1000);
      const alert = screen.queryByText(t.github.failed);
      expect(alert).not.toBeNull();
      expect(alert?.closest("[role=alert]")).not.toBeNull();
      expect(screen.queryByRole("status", { name: t.github.loading })).toBeNull();
      await press(t.github.recheck);
      await settleMaybe(() => screen.queryByText(t.github.signedOut) !== null, 1000);
      expect(screen.queryByText(t.github.signedOut)).not.toBeNull();
      expect(asked.filter((type) => type === "github.status")).toHaveLength(2);
      expect(screen.queryByText(t.github.failed)).toBeNull();
    });

    test("a sign-in the host refused says so, and the button is still there", async () => {
      await open(language, { "github.login.start": null }, [STATUS]);
      await settleMaybe(() => screen.queryByText(t.github.signedOut) !== null, 1000);
      await press(t.github.signIn);
      await settleMaybe(() => screen.queryByText(t.github.startFailed) !== null, 1000);
      const notice = screen.queryByText(t.github.startFailed);
      expect(notice).not.toBeNull();
      expect(notice?.closest("[role=alert]")).not.toBeNull();
      expect(screen.queryByRole("button", { name: t.github.signIn })).not.toBeNull();
    });

    test("a sign-out the host refused says so, and still shows who is signed in", async () => {
      await open(language, { "github.logout": null }, [SIGNED_IN]);
      const who = t.github.signedIn.replace("{login}", "octocat");
      await settleMaybe(() => screen.queryByText(who) !== null, 1000);
      await press(t.github.signOut);
      await settleMaybe(() => screen.queryByText(t.github.signOutFailed) !== null, 1000);
      const notice = screen.queryByText(t.github.signOutFailed);
      expect(notice).not.toBeNull();
      expect(notice?.closest("[role=alert]")).not.toBeNull();
      expect(screen.queryByText(who)).not.toBeNull();
      expect(screen.queryByRole("button", { name: t.github.signOut })).not.toBeNull();
    });

    test("a cancel the host refused says so, and the code stays on screen", async () => {
      await open(
        language,
        { "github.login.start": CODE, "github.login.cancel": null },
        [STATUS],
      );
      await settleMaybe(() => screen.queryByText(t.github.signedOut) !== null, 1000);
      await press(t.github.signIn);
      await settleMaybe(() => screen.queryByText(CODE.code) !== null, 1000);
      await press(t.github.cancel);
      await settleMaybe(() => screen.queryByText(t.github.cancelFailed) !== null, 1000);
      expect(screen.queryByText(t.github.cancelFailed)).not.toBeNull();
      expect(screen.queryByText(CODE.code)).not.toBeNull();
    });

    test("the waiting line says how long the code works and what to do when it is not accepted", async () => {
      await open(language, { "github.login.start": CODE }, [STATUS]);
      await settleMaybe(() => screen.queryByText(t.github.signedOut) !== null, 1000);
      await press(t.github.signIn);
      await settleMaybe(() => screen.queryByText(CODE.code) !== null, 1000);
      expect(screen.queryByText(t.github.waiting)).not.toBeNull();
      expect(screen.queryByText(t.github.codeExpires)).not.toBeNull();
    });
  });
}
