import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { Quota } from "../../daemon/src/quota/quota.ts";
import { manualTime } from "../../daemon/test/time-helpers.ts";
import { en } from "../src/i18n/en.ts";
import { ptBR } from "../src/i18n/pt-BR.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { waiter } from "./wait.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(20_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const settle = waiter(4000);

/** Times shown as UTC HH:MM, so the test does not depend on the machine's time zone. */
const utcTime = (iso: string) => new Date(iso).toISOString().slice(11, 16);
const START = Date.UTC(2026, 9, 1, 12, 0, 0);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** A host on a manual clock with both windows read (the five hours near the guard), and the app online on it. */
async function online(language: "en" | "pt-BR", features?: string[]) {
  const time = manualTime(START);
  const quota = new Quota({ pauseAt: 0.9, now: time.now, timers: time.timers });
  const d = makeDaemon(cleanups, { quota });
  const server = features ? d.listen(0, undefined, features) : d.listen();
  const mem = memoryPlatform(false, language);
  const store = new AppStore(mem.platform, {
    baseDelayMs: 60_000,
    now: () => time.now() + 12 * MINUTE,
    formatTime: utcTime,
  });
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: server.url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  await act(async () => {
    quota.record([
      {
        window: "five_hour",
        utilization: 0.85,
        status: "allowed_warning",
        resetsAt: START + 2 * HOUR,
      },
      { window: "seven_day", utilization: 0.4, status: "allowed", resetsAt: START + 48 * HOUR },
    ]);
  });
  await settle(
    () => store.getState().quota[store.getState().hosts[0]?.id ?? ""]?.windows.length === 2,
  );
  return { quota, store };
}

/** Two online hosts, each on its own quota, both read; the app shows them in one popover. */
async function twoHosts(language: "en" | "pt-BR") {
  const time = manualTime(START);
  const quotas = {
    alfa: new Quota({ pauseAt: 0.9, now: time.now, timers: time.timers }),
    beta: new Quota({ pauseAt: 0.9, now: time.now, timers: time.timers }),
  };
  const mem = memoryPlatform(false, language);
  const store = new AppStore(mem.platform, {
    baseDelayMs: 60_000,
    now: () => time.now() + 12 * MINUTE,
    formatTime: utcTime,
  });
  render(<App store={store} />);
  for (const name of ["alfa", "beta"] as const) {
    const server = makeDaemon(cleanups, { quota: quotas[name] }).listen();
    await act(async () => {
      await store.addHost({ name, url: server.url, token: TOKEN });
    });
  }
  await settle(() => store.getState().hosts.filter((h) => h.status === "online").length === 2);
  await act(async () => {
    for (const quota of Object.values(quotas)) {
      quota.record([
        {
          window: "five_hour",
          utilization: 0.5,
          status: "allowed",
          resetsAt: START + 2 * HOUR,
        },
      ]);
    }
  });
  await settle(() => Object.keys(store.getState().quota).length === 2);
  return { quotas, store };
}

const glance = () => document.querySelector<HTMLElement>('[data-slot="status-bar"] .status-quota');

async function openPopover(dict: typeof en | typeof ptBR) {
  const button = glance();
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
  const popover = screen.queryByRole("dialog", { name: dict.quota.popover.label });
  expect(popover).not.toBeNull();
  return popover as HTMLElement;
}

/** The guard select of a host, found by the name that says whose it is. */
const guardOf = (scope: HTMLElement, dict: typeof en | typeof ptBR, host = "alfa") =>
  scope.querySelector<HTMLSelectElement>(
    `select[aria-label="${dict.quota.guard.labelFor.replace("{host}", host)}"]`,
  );

for (const [lang, dict] of [
  ["en", en],
  ["pt-BR", ptBR],
] as const) {
  describe(`quota-popover (${lang}): the status bar's quota acts, it does not only show (issue #1218)`, () => {
    test("pressing the quota opens both windows of the host with their resets, and the guard where it stands", async () => {
      await online(lang);
      const popover = await openPopover(dict);
      for (const window of ["five_hour", "seven_day"] as const) {
        const label = dict.quota.meter
          .replace("{window}", dict.quota.windows[window])
          .replace("{host}", "alfa");
        expect(within(popover).queryByLabelText(label)).not.toBeNull();
      }
      expect(
        within(popover).queryByText(dict.quota.resets.replace("{time}", "14:00")),
      ).not.toBeNull();
      expect(
        within(popover).queryByText(dict.quota.resets.replace("{time}", "12:00")),
      ).not.toBeNull();
      expect(guardOf(popover, dict)?.value).toBe("0.9");
      expect(within(popover).queryByText(dict.quota.guard.hint)).not.toBeNull();
    });

    test("choosing a guard sets it on the host, and Never turns it off", async () => {
      const { quota } = await online(lang);
      const popover = await openPopover(dict);
      await act(async () => {
        fireEvent.change(guardOf(popover, dict) as HTMLElement, { target: { value: "0.7" } });
      });
      await settle(() => quota.state().pauseAt === 0.7);
      await settle(
        () => guardOf(screen.queryByRole("dialog") as HTMLElement, dict)?.value === "0.7",
      );
      await act(async () => {
        fireEvent.change(guardOf(popover, dict) as HTMLElement, { target: { value: "off" } });
      });
      await settle(() => quota.state().pauseAt === null);
      await settle(
        () => guardOf(screen.queryByRole("dialog") as HTMLElement, dict)?.value === "off",
      );
    });

    test("Show what is running opens the activity of every session and closes the popover", async () => {
      const { store } = await online(lang);
      const popover = await openPopover(dict);
      await act(async () => {
        fireEvent.click(
          within(popover).queryByRole("button", {
            name: dict.quota.popover.showRunning,
          }) as HTMLElement,
        );
      });
      expect(store.router.current.name).toBe("activity");
      expect(screen.queryByRole("dialog", { name: dict.quota.popover.label })).toBeNull();
    });

    test("the near-limit notice on the card carries the same guard and the same action", async () => {
      const { quota, store } = await online(lang);
      await act(async () => {
        quota.record([
          {
            window: "five_hour",
            utilization: 0.95,
            status: "allowed_warning",
            resetsAt: START + 2 * HOUR,
          },
        ]);
      });
      const card = screen.queryByRole("region", {
        name: dict.quota.region.replace("{host}", "alfa"),
      });
      expect(card).not.toBeNull();
      const notice = dict.quota.hotNotice.replace("{host}", "alfa").replace("{pct}", "90");
      await settle(() => within(card as HTMLElement).queryByText(notice) !== null);
      const guard = guardOf(card as HTMLElement, dict);
      expect(guard?.value).toBe("0.9");
      await act(async () => {
        fireEvent.change(guard as HTMLElement, { target: { value: "1" } });
      });
      await settle(() => quota.state().pauseAt === 1);
      await act(async () => {
        fireEvent.click(
          within(card as HTMLElement).queryByRole("button", {
            name: dict.quota.popover.showRunning,
          }) as HTMLElement,
        );
      });
      expect(store.router.current.name).toBe("activity");
    });

    test("a host that cannot change the guard from the app shows it as text, with no select", async () => {
      await online(lang, ["quota", "costs"]);
      const popover = await openPopover(dict);
      expect(guardOf(popover, dict)).toBeNull();
      expect(
        within(popover).queryByText(dict.quota.guard.readOnly.replace("{pct}", "90")),
      ).not.toBeNull();
    });

    test("Escape closes the popover and gives the focus back to the quota button", async () => {
      await online(lang);
      const popover = await openPopover(dict);
      await act(async () => {
        fireEvent.keyDown(popover, { key: "Escape" });
      });
      expect(screen.queryByRole("dialog", { name: dict.quota.popover.label })).toBeNull();
      // Radix gives the focus back after the popover unmounts, not in the same tick.
      await settle(() => document.activeElement === glance());
    });

    test("the host's own link opens its page and closes the popover", async () => {
      const { store } = await online(lang);
      const popover = await openPopover(dict);
      const link = within(popover).queryByRole("button", {
        name: dict.quota.popover.openHostOf.replace("{host}", "alfa"),
      });
      expect(link).not.toBeNull();
      await act(async () => {
        fireEvent.click(link as HTMLElement);
      });
      const route = store.router.current;
      expect(route.name === "host" && route.host === store.getState().hosts[0]?.id).toBe(true);
      expect(screen.queryByRole("dialog", { name: dict.quota.popover.label })).toBeNull();
    });

    test("with two hosts each guard carries its host's name and sets its own host", async () => {
      const { quotas } = await twoHosts(lang);
      const popover = await openPopover(dict);
      const alfa = guardOf(popover, dict, "alfa");
      const beta = guardOf(popover, dict, "beta");
      expect(alfa).not.toBeNull();
      expect(beta).not.toBeNull();
      expect(alfa === beta).toBe(false);
      await act(async () => {
        fireEvent.change(beta as HTMLElement, { target: { value: "0.6" } });
      });
      await settle(() => quotas.beta.state().pauseAt === 0.6);
      expect(quotas.alfa.state().pauseAt).toBe(0.9);
    });
  });
}
