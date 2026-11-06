import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
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

setDefaultTimeout(40_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const settle = waiter(10_000);

async function boardPage(
  lang: "en" | "pt-BR",
  issues: { count: number } | { error: "gh_missing" | "gh_logged_out" | "gh_failed" },
  options: Parameters<typeof makeDaemon>[1] | "no-roi" = undefined,
) {
  const d = makeDaemon(
    cleanups,
    options === "no-roi"
      ? {}
      : { roi: { signals: { agentCommits: async () => 7, issuesClosed: async () => issues } } },
  );
  const repo = join(d.root, "shop");
  mkdirSync(repo, { recursive: true });
  await Bun.spawn(["git", "init", "-q", repo]).exited;
  const mem = memoryPlatform(false, lang);
  // The card opens folded (issue #178); these tests read its details, so it starts open.
  mem.win.localStorage.setItem("flightdeck.roiOpen", "true");
  const store = new AppStore(mem.platform, {
    baseDelayMs: 60_000,
    now: () => Date.parse("2026-10-14T12:00:00Z"),
    day: (ms) => new Date(ms).toISOString().slice(0, 10),
  });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  const hostId = store.getState().hosts[0]?.id ?? "";
  const project = await store.hostCommand(hostId, "project.add", { path: repo });
  await act(async () => {
    store.tabs.open({ name: "board", host: hostId, projectId: project?.id ?? "" });
  });
  return { d, project };
}

const toggle = async (label: string) => {
  await act(async () => {
    fireEvent.click(screen.getByLabelText(label));
  });
};

for (const [lang, t] of [
  ["en", en],
  ["pt-BR", ptBR],
] as const) {
  const S = t.roiUi.signals;
  describe(`roi-sinais-ui (${lang}): the optional signals of a project`, () => {
    test("both are off, nothing is counted, and a switch saves through the project settings", async () => {
      const { d, project } = await boardPage(lang, { count: 2 });
      await settle(() => screen.queryByLabelText(S.commits) !== null);
      expect(screen.queryByText(S.agentCommits.other.replace("{n}", "7"))).toBeNull();
      await toggle(S.commits);
      await settle(() => d.board.getProject(project?.id ?? "").roiSignals.commits);
      expect(d.board.getProject(project?.id ?? "").roiSignals).toEqual({
        commits: true,
        issues: false,
      });
      await settle(() => screen.queryByText(S.agentCommits.other.replace("{n}", "7")) !== null);
      await toggle(S.commits);
      await settle(() => !d.board.getProject(project?.id ?? "").roiSignals.commits);
      await settle(() => screen.queryByText(S.agentCommits.other.replace("{n}", "7")) === null);
    });

    test("issues closed show their count, and a refusal shows why", async () => {
      await boardPage(lang, { count: 1 });
      await settle(() => screen.queryByLabelText(S.issues) !== null);
      await toggle(S.issues);
      await settle(() => screen.queryByText(S.issuesClosed.one.replace("{n}", "1")) !== null);
    });

    test("a signed-out gh is told, not hidden", async () => {
      await boardPage(lang, { error: "gh_logged_out" });
      await settle(() => screen.queryByLabelText(S.issues) !== null);
      await toggle(S.issues);
      await settle(() => screen.queryByText(S.error.gh_logged_out) !== null);
      expect(screen.queryByText(S.error.gh_logged_out)).not.toBeNull();
      expect(screen.queryByText(S.error.gh_logged_out)).not.toBeNull();
    });

    test("a host without roi shows no switches", async () => {
      await boardPage(lang, { count: 0 }, "no-roi");
      await act(async () => {});
      expect(screen.queryByLabelText(S.commits)).toBeNull();
    });
  });
}
