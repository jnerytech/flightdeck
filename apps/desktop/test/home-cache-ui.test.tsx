import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { CostsSummary, UsageSummary } from "@flightdeck/protocol";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, render, waitFor, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { emptySummary } = await import("../src/lib/client-costs.ts");
const { HomePage } = await import("../src/ui/HomePage.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const costsOf = (usd: number): CostsSummary => {
  const summary = emptySummary("2026-10-04", "2026-10-10");
  summary.byDay = [{ day: "2026-10-10", projectKey: "secret-project", costUsd: usd, tokens: 1000 }];
  summary.totals.costUsd = usd;
  summary.totals.tokens.input = 1000;
  return summary;
};
const usageOf = (turns: number): UsageSummary => ({
  days: 7,
  rows: [
    {
      day: "2026-10-10",
      projectKey: "secret-project",
      costUsd: 1,
      inputTokens: 1,
      outputTokens: 1,
      turns,
      failedTurns: 0,
      durationMs: 1000,
    },
  ],
});

/** What a read of the hosts does: answers with these numbers, never answers, or refuses. */
type Mode = { answer: { usd: number; turns: number } } | "hang" | "refuse";

function app(platform = memoryPlatform(false, "en").platform, hostCount = 1) {
  const store = new AppStore(platform, { baseDelayMs: 600_000, day: () => "2026-10-10" });
  store.i18n.start();
  const control: { mode: Mode; release: (() => void) | null } = {
    mode: { answer: { usd: 2.25, turns: 4 } },
    release: null,
  };
  store.hostRequest = (async (_hostId: string, command: string) => {
    if (control.mode === "hang") {
      await new Promise<void>((done) => {
        control.release = done;
      });
      control.mode = { answer: { usd: 7.5, turns: 9 } };
    }
    if (control.mode === "refuse") return { ok: false, code: "internal", message: "no" };
    const { usd, turns } = control.mode.answer;
    return command === "costs.summary"
      ? { ok: true, data: costsOf(usd) }
      : { ok: true, data: usageOf(turns) };
  }) as never;
  const hosts = Array.from({ length: hostCount }, (_, i) => ({
    id: `h${i + 1}`,
    name: `host${i + 1}`,
    status: "online",
    hostInfo: { daemonVersion: "x", features: ["costs"] },
    sessions: [],
  }));
  const state = {
    ...store.getState(),
    hosts,
    hostsLoaded: true,
    budgets: {},
  } as never as ReturnType<typeof store.getState>;
  const view = <HomePage store={store} state={state} go={() => {}} />;
  return { view, store, control, platform };
}

const spend = () => screen.queryByRole("button", { name: "Open Spend" })?.textContent ?? "";
const text = () => document.body.textContent ?? "";

describe("home-cache-ui: Home shows the last numbers at once and reads again in the background (issue #607)", () => {
  test("a second visit shows the cached numbers before the read answers, then replaces them", async () => {
    const first = app();
    render(first.view);
    await waitFor(() => expect(spend()).toContain("$2.25"));
    cleanup();
    // The next visit: the host takes its time.
    first.control.mode = "hang";
    render(first.view);
    expect(spend()).toContain("$2.25");
    expect(text()).toContain("Updated now");
    await act(async () => {
      first.control.release?.();
    });
    await waitFor(() => expect(spend()).toContain("$7.50"));
  });

  test("the numbers outlive the app: a new store on the same storage shows them at once", async () => {
    const first = app();
    render(first.view);
    await waitFor(() => expect(spend()).toContain("$2.25"));
    cleanup();
    const second = app(first.platform);
    second.control.mode = "hang";
    render(second.view);
    expect(spend()).toContain("$2.25");
    // Only numbers and the time they were read are kept on disk: no project, title or folder.
    const stored = JSON.stringify(first.platform.storage.getItem("flightdeck.home.v1"));
    expect(stored).not.toContain("secret-project");
    expect(stored).toContain("2.25");
  });

  test("a host that fails keeps its last numbers, marked as stale, and the other keeps replacing", async () => {
    const first = app();
    render(first.view);
    await waitFor(() => expect(spend()).toContain("$2.25"));
    cleanup();
    first.control.mode = "refuse";
    render(first.view);
    await waitFor(() => expect(text()).toContain("host1"));
    expect(spend()).toContain("$2.25");
    expect(text()).toContain("Showing the last numbers of host1");
  });

  test("a damaged cache in the storage is ignored: Home reads as usual and writes a valid one", async () => {
    const platform = memoryPlatform(false, "en").platform;
    platform.storage.setItem("flightdeck.home.v1", "{ not json");
    const damaged = app(platform);
    render(damaged.view);
    await waitFor(() => expect(spend()).toContain("$2.25"));
    await waitFor(() =>
      expect(typeof platform.storage.getItem("flightdeck.home.v1")).toBe("string"),
    );
    expect(() => JSON.parse(platform.storage.getItem("flightdeck.home.v1") ?? "")).not.toThrow();
    expect(platform.storage.getItem("flightdeck.home.v1")).toContain("2.25");
  });

  test("a storage that refuses writes does not stop Home: the cache stays in memory", async () => {
    const platform = memoryPlatform(false, "en").platform;
    const refusing = app({
      ...platform,
      storage: {
        getItem: () => null,
        setItem: () => {
          throw new Error("quota");
        },
      },
    });
    render(refusing.view);
    await waitFor(() => expect(spend()).toContain("$2.25"));
    cleanup();
    refusing.control.mode = "hang";
    render(refusing.view);
    expect(spend()).toContain("$2.25");
  });

  test("another host set has its own entry: it shows no numbers of the first one while it reads", async () => {
    const first = app();
    render(first.view);
    await waitFor(() => expect(spend()).toContain("$2.25"));
    cleanup();
    const two = app(first.platform, 2);
    two.control.mode = "hang";
    render(two.view);
    expect(spend()).toBe("");
    await act(async () => {
      two.control.release?.();
    });
    await waitFor(() => expect(spend()).toContain("$15.00"));
  });

  test("the updated line and the stale line are in both languages", async () => {
    for (const lang of ["en", "pt-BR"] as const) {
      const first = app(memoryPlatform(false, lang).platform);
      render(first.view);
      await waitFor(() => expect(spend()).toContain("2"));
      cleanup();
      first.control.mode = "refuse";
      render(first.view);
      const { t } = first.store.i18n;
      await waitFor(() =>
        expect(text()).toContain(t("home.stale", { hosts: "host1", ago: t("time.now") })),
      );
      expect(text()).toContain(t("home.updated", { ago: t("time.now") }));
      cleanup();
    }
  });
});
