import { afterEach, describe, expect, test } from "bun:test";
import { en } from "../src/i18n/en.ts";
import { translator } from "../src/i18n/index.ts";
import { ptBR } from "../src/i18n/pt-BR.ts";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { StatusBar } = await import("../src/components/shell/status-bar.tsx");

afterEach(cleanup);

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
  percent: 59,
  remaining: "1d 10h",
  level: "ok" as const,
};

for (const [lang, dict] of [
  ["en", en],
  ["pt-BR", ptBR],
] as const) {
  const t = translator(lang);
  const fill = (text: string, vars: Record<string, string>) =>
    Object.entries(vars).reduce((s, [k, v]) => s.replace(`{${k}}`, v), text);

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
  const click = (el: HTMLElement) =>
    act(async () => {
      fireEvent.click(el);
    });

  describe(`status bar (${lang}): the slim bar at the bottom (issue #491)`, () => {
    test("it is one named region, with the quota on the left and the app's state on the right", () => {
      bar();
      const region = screen.getByRole("region", { name: dict.statusBar.label });
      expect(region.getAttribute("data-slot")).toBe("status-bar");
      const names = within(region)
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label"));
      const window = dict.account.windows.five_hour;
      expect(names).toEqual([
        fill(dict.shell.quotaLabel, {
          state: dict.shell.quotaLevels.ok,
          window,
          percent: "59",
          host: "alfa",
          remaining: "1d 10h",
        }),
        dict.statusBar.refreshQuota,
        dict.statusBar.keepAwake.holding,
        fill(dict.statusBar.terminals, { n: "4" }),
        fill(dict.statusBar.hosts, { online: "2", total: "3" }),
      ]);
    });

    test("each item opens its page, and the refresh asks for the quota again", async () => {
      const calls = bar();
      const button = (name: string) => screen.getByRole("button", { name });
      await click(button(dict.statusBar.refreshQuota));
      await click(button(dict.statusBar.keepAwake.holding));
      await click(button(fill(dict.statusBar.terminals, { n: "4" })));
      await click(button(fill(dict.statusBar.hosts, { online: "2", total: "3" })));
      await click(
        button(
          fill(dict.shell.quotaLabel, {
            state: dict.shell.quotaLevels.ok,
            window: dict.account.windows.five_hour,
            percent: "59",
            host: "alfa",
            remaining: "1d 10h",
          }),
        ),
      );
      expect(calls).toEqual(["refresh", "awake:alfa", "terminals", "hosts", "quota:alfa"]);
    });

    test("the live counts are status regions, so a change is announced", () => {
      bar();
      const region = screen.getByRole("region", { name: dict.statusBar.label });
      const live = within(region)
        .getAllByRole("status")
        .map((el) => el.textContent);
      expect(live).toEqual(["4", "2/3"]);
    });

    test("near the limit the quota says so in words and with a mark, and the refresh waits while it asks", () => {
      bar({
        quota: { glance: { ...GLANCE, level: "reached", percent: 100 }, hostName: "alfa" },
        refreshing: true,
      });
      const quota = screen.getByRole("button", {
        name: new RegExp(dict.shell.quotaLevels.reached),
      });
      expect(quota.querySelector("[data-mark]")).not.toBeNull();
      const refresh = screen.getByRole("button", { name: dict.statusBar.refreshingQuota });
      expect((refresh as HTMLButtonElement).disabled).toBe(true);
      expect(refresh.getAttribute("aria-busy")).toBe("true");
    });

    test("what no host reports is not drawn: no quota, no keep-awake, no update", () => {
      bar({
        quota: null,
        summary: { ...SUMMARY, keepAwake: null, keepAwakeHostId: null, terminals: 0 },
      });
      const names = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"));
      expect(names).toEqual([
        fill(dict.statusBar.terminals, { n: "0" }),
        fill(dict.statusBar.hosts, { online: "2", total: "3" }),
      ]);
    });

    test("one terminal and one host read in the singular, keep-awake says when it is on or off", () => {
      bar({
        summary: { ...SUMMARY, terminals: 1, hostsTotal: 1, hostsOnline: 1, keepAwake: "on" },
      });
      expect(screen.queryByRole("button", { name: dict.statusBar.terminalsOne })).not.toBeNull();
      expect(
        screen.queryByRole("button", { name: fill(dict.statusBar.hostsOne, { online: "1" }) }),
      ).not.toBeNull();
      expect(screen.queryByRole("button", { name: dict.statusBar.keepAwake.on })).not.toBeNull();
      cleanup();
      bar({ summary: { ...SUMMARY, keepAwake: "off" } });
      expect(screen.queryByRole("button", { name: dict.statusBar.keepAwake.off })).not.toBeNull();
    });

    test("an update on offer, ready to install or failed is named in words and opens Settings", async () => {
      for (const [update, version, name] of [
        ["available", "0.38.0", dict.statusBar.update.available],
        ["ready", "0.38.0", dict.statusBar.update.ready],
        ["failed", null, dict.statusBar.update.failed],
      ] as const) {
        const calls = bar({ summary: { ...SUMMARY, update, updateVersion: version } });
        const button = screen.getByRole("button", { name: fill(name, { version: version ?? "" }) });
        await click(button);
        expect(calls).toEqual(["update"]);
        cleanup();
      }
    });
  });
}
