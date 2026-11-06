import { afterEach, describe, expect, test } from "bun:test";
import { en } from "../src/i18n/en.ts";
import { translator } from "../src/i18n/index.ts";
import { ptBR } from "../src/i18n/pt-BR.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { waiter } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { StatusBar } = await import("../src/components/shell/status-bar.tsx");

const settle = waiter(4000);

/** happy-dom evaluates media queries against its viewport and fires `change` on resize. */
async function viewport(width: number) {
  await act(async () => {
    (window as unknown as { happyDOM: { setViewport(v: object): void } }).happyDOM.setViewport({
      width,
      height: 800,
    });
  });
  await settle(() => window.matchMedia("(width < 1024px)").matches === width < 1024);
  await settle(() => window.matchMedia("(width < 640px)").matches === width < 640);
  await act(async () => {});
}

afterEach(async () => {
  cleanup();
  await viewport(1280);
});

const SUMMARY = {
  hostsOnline: 2,
  hostsTotal: 3,
  terminals: 4,
  keepAwake: "holding" as const,
  keepAwakeHostId: "alfa",
  update: null,
  updateVersion: null,
};
const GLANCE = {
  hostId: "alfa",
  window: "five_hour",
  percent: 42,
  remaining: "2h 59m",
  level: "ok" as const,
};

for (const [lang, dict] of [
  ["en", en],
  ["pt-BR", ptBR],
] as const) {
  const t = translator(lang);

  function bar(over: Partial<Parameters<typeof StatusBar>[0]> = {}) {
    const calls: string[] = [];
    render(
      <StatusBar
        t={t}
        quota={{ glance: GLANCE, hostName: "alfa" }}
        refreshing={false}
        summary={SUMMARY}
        onRefreshQuota={() => calls.push("refresh")}
        onOpenQuota={(id) => calls.push(`quota:${id}`)}
        onOpenKeepAwake={(id) => calls.push(`awake:${id}`)}
        onOpenTerminals={() => calls.push("terminals")}
        onOpenHosts={() => calls.push("hosts")}
        onOpenUpdate={() => calls.push("update")}
        {...over}
      />,
    );
    return calls;
  }
  const region = () => screen.getByRole("region", { name: dict.statusBar.label });
  const inBar = () =>
    within(region())
      .queryAllByRole("button")
      .map((b) => b.getAttribute("aria-label"));
  const terminals = dict.statusBar.terminals.replace("{n}", "4");
  const hosts = dict.statusBar.hosts.replace("{online}", "2").replace("{total}", "3");

  describe(`status bar (${lang}): by window width (issue #641)`, () => {
    test("wide and medium keep every item, named in words; medium drops the words beside the values", async () => {
      bar();
      expect(region().getAttribute("data-breakpoint")).toBe("wide");
      expect(inBar()).toHaveLength(5);
      cleanup();
      await viewport(800);
      bar();
      expect(region().getAttribute("data-breakpoint")).toBe("medium");
      // The same five buttons, each with its name: what goes is only the visible words.
      expect(inBar()).toHaveLength(5);
      expect(inBar()).toContain(terminals);
      expect(inBar()).toContain(hosts);
      expect(region().querySelectorAll(".status-short").length).toBeGreaterThan(0);
    });

    test("compact keeps the quota and keep-awake; the rest is behind a More button, and nothing overlaps", async () => {
      await viewport(500);
      bar();
      expect(region().getAttribute("data-breakpoint")).toBe("compact");
      const names = inBar();
      expect(names).toHaveLength(3);
      expect(names).toContain(dict.statusBar.keepAwake.holding);
      expect(names).toContain(dict.statusBar.more);
      expect(names).not.toContain(terminals);
      expect(names).not.toContain(hosts);
      expect(names).not.toContain(dict.statusBar.refreshQuota);
    });

    test("More lists the refresh, the terminals, the hosts and the update, each opening its page", async () => {
      await viewport(500);
      const calls = bar({
        summary: { ...SUMMARY, update: "available", updateVersion: "9.9.9" },
      });
      const more = within(region()).getByRole("button", { name: dict.statusBar.more });
      expect(more.getAttribute("aria-expanded")).toBe("false");
      await act(async () => {
        fireEvent.click(more);
      });
      expect(more.getAttribute("aria-expanded")).toBe("true");
      const item = (name: string) => screen.getByRole("button", { name });
      expect(item(dict.statusBar.refreshQuota)).toBeDefined();
      await act(async () => {
        fireEvent.click(item(terminals));
      });
      expect(calls).toEqual(["terminals"]);
      // Choosing an item closes the list.
      expect(more.getAttribute("aria-expanded")).toBe("false");
      await act(async () => {
        fireEvent.click(more);
      });
      await act(async () => {
        fireEvent.click(item(hosts));
      });
      await act(async () => {
        fireEvent.click(more);
      });
      await act(async () => {
        fireEvent.click(item(dict.statusBar.update.available.replace("{version}", "9.9.9")));
      });
      await act(async () => {
        fireEvent.click(more);
      });
      await act(async () => {
        fireEvent.click(item(dict.statusBar.refreshQuota));
      });
      expect(calls).toEqual(["terminals", "hosts", "update", "refresh"]);
    });

    test("compact with no quota and no keep-awake leaves only the More button", async () => {
      await viewport(500);
      bar({ quota: null, summary: { ...SUMMARY, keepAwake: null, keepAwakeHostId: null } });
      expect(inBar()).toEqual([dict.statusBar.more]);
    });
  });
}
