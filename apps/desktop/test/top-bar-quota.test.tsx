import { afterEach, describe, expect, test } from "bun:test";
import { en } from "../src/i18n/en.ts";
import { translator } from "../src/i18n/index.ts";
import { ptBR } from "../src/i18n/pt-BR.ts";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { QuotaGlanceButton } = await import("../src/components/shell/status-bar.tsx");

afterEach(() => cleanup());

const fill = (text: string, vars: Record<string, string>) =>
  Object.entries(vars).reduce((s, [k, v]) => s.replace(`{${k}}`, v), text);

for (const [lang, dict] of [
  ["en", en],
  ["pt-BR", ptBR],
] as const) {
  const t = translator(lang);
  const window = dict.account.windows.five_hour;
  describe(`top-bar-quota (${lang}): the plan quota at a glance, a button of the status bar (issue #118, #491)`, () => {
    test("it shows the window and the percent, says the rest in its name, and opens the host", async () => {
      const opened: string[] = [];
      render(
        <QuotaGlanceButton
          t={t}
          glance={{
            hostId: "b",
            window: "five_hour",
            percent: 62,
            remaining: "2h 47m",
            level: "ok",
          }}
          hostName="beta"
          onOpen={(id) => opened.push(id)}
        />,
      );
      const name = fill(dict.shell.quotaLabel, {
        state: dict.shell.quotaLevels.ok,
        window,
        percent: "62",
        host: "beta",
        remaining: "2h 47m",
      });
      const button = screen.queryByRole("button", { name });
      expect(button).not.toBeNull();
      expect(button?.textContent ?? "").toContain("62%");
      expect(screen.queryByRole("meter")?.getAttribute("value")).toBe("62");
      await act(async () => {
        fireEvent.click(button as HTMLElement);
      });
      expect(opened).toEqual(["b"]);
    });

    test("near the limit it says so in words and with a mark, not by colour alone", () => {
      render(
        <QuotaGlanceButton
          t={t}
          glance={{ hostId: "b", window: "five_hour", percent: 85, remaining: "", level: "near" }}
          hostName="beta"
          onOpen={() => undefined}
        />,
      );
      const name = fill(dict.shell.quotaLabelNoReset, {
        state: dict.shell.quotaLevels.near,
        window,
        percent: "85",
        host: "beta",
      });
      const button = screen.queryByRole("button", { name });
      expect(button).not.toBeNull();
      expect(button?.getAttribute("data-level")).toBe("near");
      expect(button?.querySelector("svg[data-mark]") !== null).toBe(true);
    });

    test("with no host reporting a quota, nothing shows", () => {
      render(<QuotaGlanceButton t={t} glance={null} hostName="" onOpen={() => undefined} />);
      expect(screen.queryByRole("meter")).toBeNull();
    });
  });
}

describe("status-bar: the slot over the app's state (issue #491)", () => {
  test("the quota glance reads the online hosts' quota, names the host and opens it", async () => {
    const { StatusBarSlot } = await import("../src/components/shell/status-bar.tsx");
    const routes: unknown[] = [];
    const state = {
      hosts: [
        { id: "a", name: "alfa", status: "online" },
        { id: "b", name: "beta", status: "offline" },
      ],
      appUpdate: { offer: null, upToDate: false, error: null, ready: null },
      settings: { autoUpdate: false },
      quota: {
        a: {
          pauseAt: null,
          windows: [
            {
              window: "seven_day",
              utilization: 0.35,
              status: "allowed",
              resetsAt: null,
              readAt: "2026-11-06T12:00:00.000Z",
            },
          ],
        },
        b: {
          pauseAt: null,
          windows: [
            {
              window: "five_hour",
              utilization: 0.9,
              status: "allowed_warning",
              resetsAt: null,
              readAt: "2026-11-06T12:00:00.000Z",
            },
          ],
        },
      },
    } as never;
    const calls: string[] = [];
    render(
      <StatusBarSlot
        t={translator("en")}
        state={state}
        now={Date.UTC(2026, 10, 6, 12)}
        terminalTabs={2}
        refreshing={false}
        onRefreshQuota={() => calls.push("refresh")}
        onOpenTerminals={() => calls.push("terminals")}
        go={(route) => routes.push(route)}
      />,
    );
    // beta is offline: its 90% is not the glance; alfa's 7 days at 35% is.
    const button = screen.queryByRole("button", { name: /7 days at 35% on alfa/ });
    expect(button).not.toBeNull();
    await act(async () => {
      fireEvent.click(button as HTMLElement);
    });
    // The hosts item goes to the host that is not online; Settings is where an update is dealt with.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "1 of 2 hosts online" }));
      fireEvent.click(screen.getByRole("button", { name: "2 open terminals" }));
      fireEvent.click(screen.getByRole("button", { name: "Refresh the plan usage" }));
    });
    expect(routes).toEqual([
      { name: "host", host: "a" },
      { name: "host", host: "b" },
    ]);
    expect(calls).toEqual(["terminals", "refresh"]);
  });
});
