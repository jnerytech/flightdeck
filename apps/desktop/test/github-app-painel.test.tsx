import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { type AxeViolation, blocking, describeViolation } from "../../../scripts/lib/axe.ts";
import { type FakeCli, type FakeRule, installFakeCli } from "../../../scripts/test/fake-cli.ts";
import { en } from "../src/i18n/en.ts";
import { ptBR } from "../src/i18n/pt-BR.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { waiter } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");
const axe = (await import("axe-core")).default;

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const settle = waiter(8000);

const CODE = "ABCD-1234";
const SIGNED_OUT: FakeRule = {
  args: ["auth", "status"],
  code: 1,
  stderr: "You are not logged into any GitHub hosts. To log in, run: gh auth login\n",
};
const signedIn = (source = "keyring"): FakeRule => ({
  args: ["auth", "status"],
  stdout: `github.com\n  ✓ Logged in to github.com account octocat (${source})\n  - Token scopes: 'repo', 'read:project'\n`,
});
const LOGIN: FakeRule = {
  args: ["auth", "login"],
  stderr: `! First copy your one-time code: ${CODE}\nOpen https://github.com/login/device\n`,
  delayMs: 30_000,
};

function fakeGh(rules: FakeRule[]): FakeCli {
  const cli = installFakeCli("gh", rules);
  cleanups.push(cli.restore);
  return cli;
}

async function hostPage(
  lang: "en" | "pt-BR",
  options: Parameters<typeof makeDaemon>[1] = { github: true },
) {
  const d = makeDaemon(cleanups, options);
  const mem = memoryPlatform(false, lang);
  const copies: string[] = [];
  const opened: string[] = [];
  const platform = {
    ...mem.platform,
    copyText: async (text: string) => {
      copies.push(text);
    },
    openExternal: async (url: string) => {
      opened.push(url);
    },
  };
  const store = new AppStore(platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  const hostId = store.getState().hosts[0]?.id ?? "";
  await act(async () => {
    store.tabs.open({ name: "host", host: hostId });
  });
  return { d, store, hostId, copies, opened };
}

const click = async (name: string) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};

for (const [lang, t] of [
  ["en", en],
  ["pt-BR", ptBR],
] as const) {
  describe(`github-app (${lang}): the GitHub panel of a host`, () => {
    test("a host without the github feature shows no GitHub panel", async () => {
      fakeGh([SIGNED_OUT]);
      await hostPage(lang, {});
      await act(async () => {});
      expect(screen.queryByRole("button", { name: t.github.signIn })).toBeNull();
      expect(screen.queryByText(t.github.hint)).toBeNull();
    });

    test("signed out: sign in shows the one-time code, copies it, opens GitHub, and flips to signed in", async () => {
      const gh = fakeGh([SIGNED_OUT, LOGIN]);
      const page = await hostPage(lang);
      await settle(() => screen.queryByText(t.github.signedOut) !== null);
      await click(t.github.signIn);
      await settle(() => screen.queryByText(CODE) !== null);
      expect(screen.queryByText(t.github.waiting)).not.toBeNull();
      await click(t.github.copyCode);
      expect(page.copies).toEqual([CODE]);
      await click(t.github.openGithub);
      expect(page.opened).toEqual(["https://github.com/login/device"]);
      // The person confirms on GitHub: gh now says it is signed in.
      gh.respond([signedIn(), LOGIN]);
      await settle(
        () => screen.queryByText(t.github.signedIn.replace("{login}", "octocat")) !== null,
      );
      expect(screen.queryByText(CODE)).toBeNull();
    });

    test("cancel stops the sign-in and goes back to the button", async () => {
      fakeGh([SIGNED_OUT, LOGIN]);
      await hostPage(lang);
      await settle(() => screen.queryByText(t.github.signedOut) !== null);
      await click(t.github.signIn);
      await settle(() => screen.queryByText(CODE) !== null);
      await click(t.github.cancel);
      await settle(() => screen.queryByRole("button", { name: t.github.signIn }) !== null);
      expect(screen.queryByText(CODE)).toBeNull();
    });

    test("signed in: the account, where the login lives and the scopes; sign out goes back to signed out", async () => {
      const gh = fakeGh([signedIn(), { args: ["auth", "logout"] }]);
      await hostPage(lang);
      await settle(
        () => screen.queryByText(t.github.signedIn.replace("{login}", "octocat")) !== null,
      );
      expect(document.body.textContent).toContain(t.github.source.keyring);
      expect(document.body.textContent).toContain("repo, read:project");
      gh.respond([SIGNED_OUT, { args: ["auth", "logout"] }]);
      await click(t.github.signOut);
      await settle(() => screen.queryByText(t.github.signedOut) !== null);
    });

    test("a login that comes from the environment cannot be signed out here, and says why", async () => {
      fakeGh([signedIn("GH_TOKEN")]);
      await hostPage(lang);
      await settle(
        () => screen.queryByText(t.github.signedIn.replace("{login}", "octocat")) !== null,
      );
      const out = screen.queryByRole("button", { name: t.github.signOut });
      expect(
        out?.getAttribute("aria-disabled") === "true" || (out as HTMLButtonElement).disabled,
      ).toBe(true);
      expect(document.body.textContent).toContain(t.github.signOutEnv);
    });

    test("gh not installed on the host: says so, with a way to check again", async () => {
      await hostPage(lang, { github: { gh: async () => null } });
      await settle(() => screen.queryByText(t.github.notInstalled) !== null);
      expect(screen.queryByRole("button", { name: t.github.recheck })).not.toBeNull();
    });

    test("no blocking accessibility violation", async () => {
      fakeGh([SIGNED_OUT, LOGIN]);
      await hostPage(lang);
      await settle(() => screen.queryByText(t.github.signedOut) !== null);
      await click(t.github.signIn);
      await settle(() => screen.queryByText(CODE) !== null);
      const result = await axe.run(document.body, {
        rules: { "color-contrast": { enabled: false } },
      });
      expect(
        blocking(result.violations as AxeViolation[]).map((v) => describeViolation("github", v)),
      ).toEqual([]);
    });
  });
}
