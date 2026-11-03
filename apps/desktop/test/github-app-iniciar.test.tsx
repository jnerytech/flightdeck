import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
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

setDefaultTimeout(40_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const settle = waiter(10_000);

const SIGNED_IN: FakeRule = {
  args: ["auth", "status"],
  stdout:
    "github.com\n  ✓ Logged in to github.com account octocat (keyring)\n  - Token scopes: 'repo', 'read:project'\n",
};
const ghIssue = (n: number) => ({
  number: n,
  title: `Fix the login ${n}`,
  body: `The login breaks, case ${n}`,
  url: `https://github.com/octocat/app/issues/${n}`,
  author: { login: "octocat" },
  labels: [],
  createdAt: "2026-10-01T10:00:00Z",
  authorAssociation: "OWNER",
});
const REPO = {
  nameWithOwner: "octocat/app",
  description: "an app",
  isPrivate: true,
  url: "https://github.com/octocat/app",
  updatedAt: "2026-10-01T10:00:00Z",
};
const RULES: FakeRule[] = [
  SIGNED_IN,
  { args: ["api", "user"], stdout: "octocat\n" },
  { args: ["repo", "list"], stdout: JSON.stringify([REPO]) },
  {
    args: ["search", "repos"],
    stdout: JSON.stringify([{ ...REPO, nameWithOwner: undefined, fullName: "acme/found" }]),
  },
  { args: ["issue", "list"], stdout: JSON.stringify([ghIssue(7), ghIssue(8)]) },
  { args: ["issue", "view", "7"], stdout: JSON.stringify(ghIssue(7)) },
];

function fakeGh(rules: FakeRule[] = RULES): FakeCli {
  const cli = installFakeCli("gh", rules);
  cleanups.push(cli.restore);
  return cli;
}

async function projectsPage(
  lang: "en" | "pt-BR",
  options: Parameters<typeof makeDaemon>[1] = { github: true },
) {
  const d = makeDaemon(cleanups, options);
  const store = new AppStore(memoryPlatform(false, lang).platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  const hostId = store.getState().hosts[0]?.id ?? "";
  await act(async () => {
    store.tabs.open({ name: "projects", host: hostId });
  });
  return { d, store, hostId };
}

const cardsOf = (d: ReturnType<typeof makeDaemon>) =>
  d.eventStore.db.query("SELECT title, issue_ref AS issueRef FROM cards").all() as Array<{
    title: string;
    issueRef: string | null;
  }>;

const click = async (name: string | RegExp) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};
const pick = async (name: string | RegExp) => {
  const radio = screen.queryByRole("radio", { name });
  expect(radio).not.toBeNull();
  await act(async () => {
    fireEvent.click(radio as HTMLElement);
  });
};

for (const [lang, t] of [
  ["en", en],
  ["pt-BR", ptBR],
] as const) {
  describe(`github-app (${lang}): start from GitHub`, () => {
    test("a host without the github feature offers nothing", async () => {
      fakeGh();
      await projectsPage(lang, {});
      await act(async () => {});
      expect(screen.queryByRole("button", { name: t.githubStart.open })).toBeNull();
    });

    test("lists the person's repositories and searches by text", async () => {
      const gh = fakeGh();
      await projectsPage(lang);
      await settle(() => screen.queryByRole("button", { name: t.githubStart.open }) !== null);
      await click(t.githubStart.open);
      await settle(() => screen.queryByRole("radio", { name: /octocat\/app/ }) !== null);
      await act(async () => {
        fireEvent.change(screen.queryByLabelText(t.githubStart.search) as HTMLElement, {
          target: { value: "login bug" },
        });
      });
      await click(t.githubStart.searchButton);
      await settle(() => screen.queryByRole("radio", { name: /acme\/found/ }) !== null);
      expect(
        gh.calls().some((call) => call.includes("search") && call.at(-1) === "login bug"),
      ).toBe(true);
    });

    test("an issue becomes a card on the board, in a clone inside the allowed folder", async () => {
      fakeGh();
      const { d } = await projectsPage(lang);
      await settle(() => screen.queryByRole("button", { name: t.githubStart.open }) !== null);
      await click(t.githubStart.open);
      await settle(() => screen.queryByRole("radio", { name: /octocat\/app/ }) !== null);
      await pick(/octocat\/app/);
      await settle(() => screen.queryByRole("radio", { name: /Fix the login 7/ }) !== null);
      await pick(/Fix the login 7/);
      await pick(t.githubStart.modeCard);
      await click(t.githubStart.start);
      await settle(() => d.board.listProjects().length === 1);
      const project = d.board.listProjects()[0];
      expect(project?.path).toBe(join(d.root, "app"));
      await settle(() => cardsOf(d).length === 1);
      expect(cardsOf(d)[0]).toMatchObject({
        title: "Fix the login 7",
        issueRef: "github:octocat/app#7",
      });
    });

    test("no issue: just the repository is cloned and registered, with no card", async () => {
      fakeGh();
      const { d } = await projectsPage(lang);
      await settle(() => screen.queryByRole("button", { name: t.githubStart.open }) !== null);
      await click(t.githubStart.open);
      await settle(() => screen.queryByRole("radio", { name: /octocat\/app/ }) !== null);
      await pick(/octocat\/app/);
      await settle(() => screen.queryByRole("radio", { name: t.githubStart.wholeRepo }) !== null);
      await click(t.githubStart.start);
      await settle(() => d.board.listProjects().length === 1);
      expect(cardsOf(d)).toEqual([]);
    });

    test("as a session: it opens in the clone, named after the issue", async () => {
      fakeGh();
      const { d } = await projectsPage(lang);
      await settle(() => screen.queryByRole("button", { name: t.githubStart.open }) !== null);
      await click(t.githubStart.open);
      await settle(() => screen.queryByRole("radio", { name: /octocat\/app/ }) !== null);
      await pick(/octocat\/app/);
      await settle(() => screen.queryByRole("radio", { name: /Fix the login 7/ }) !== null);
      await pick(/Fix the login 7/);
      await pick(t.githubStart.modeSession);
      await click(t.githubStart.start);
      await settle(() => d.manager.list().length === 1);
      expect(d.manager.list()[0]).toMatchObject({
        cwd: join(d.root, "app"),
        name: "Fix the login 7",
      });
    });

    test("a refusal is said in the app's language, in the dialog", async () => {
      fakeGh([
        {
          args: ["auth", "status"],
          code: 1,
          stderr: "You are not logged into any GitHub hosts.\n",
        },
      ]);
      await projectsPage(lang);
      await settle(() => screen.queryByRole("button", { name: t.githubStart.open }) !== null);
      await click(t.githubStart.open);
      await settle(() => screen.queryByText(t.daemonRefusal.gh_logged_out) !== null);
    });

    test("no blocking accessibility violation with the dialog open", async () => {
      fakeGh();
      await projectsPage(lang);
      await settle(() => screen.queryByRole("button", { name: t.githubStart.open }) !== null);
      await click(t.githubStart.open);
      await settle(() => screen.queryByRole("radio", { name: /octocat\/app/ }) !== null);
      const result = await axe.run(document.body, {
        rules: { "color-contrast": { enabled: false } },
      });
      expect(
        blocking(result.violations as AxeViolation[]).map((v) => describeViolation("github", v)),
      ).toEqual([]);
    });
  });
}
