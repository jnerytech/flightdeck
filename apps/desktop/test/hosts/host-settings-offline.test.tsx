import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { FEATURE_RESUME_OFFER } from "@flightdeck/protocol";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";

registerDom();
const { cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { HostSettingsPanel } = await import("../../src/features/hosts/host-settings-panel.tsx");
const { TContext } = await import("../../src/i18n/context.tsx");

setDefaultTimeout(20_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** The moment the host last answered `host.info`, on a day that is not today so the line names the day. */
const AS_OF = Date.parse("2026-11-20T10:42:00.000Z");

/** A host with a panel of each kind the issue names, last reported in `status`. */
const hostIn = (status: string, withInfo = true) => ({
  id: "h1",
  name: "pi",
  url: "ws://x",
  token: "",
  status,
  info: null,
  hostInfo: withInfo
    ? {
        daemonVersion: "x",
        features: ["hostPause", "keepAwake", "autoUpdate", FEATURE_RESUME_OFFER],
        pause: { paused: false, running: 0 },
        keepAwake: { enabled: true, held: false, method: null, reason: null },
        sleepAfterMinutes: 30,
        allowBypassPermissions: false,
        autoUpdate: { enabled: true, state: "current" },
        update: {
          available: true,
          version: "9.9.9",
          checkedAt: "2026-11-20T10:00:00.000Z",
        },
      }
    : null,
  infoAt: withInfo ? AS_OF : 0,
  retry: null,
  incompatibility: null,
  daemonUpdate: null,
  updateCheck: null,
  sessions: [],
});

/** The Settings tab of a host in `status`, in `language`, with no daemon behind it. */
function settings(status: string, language: "en" | "pt-BR" = "en", withInfo = true) {
  const store = new AppStore(memoryPlatform(false, language).platform, { baseDelayMs: 600_000 });
  cleanups.push(() => store.dispose());
  store.i18n.start();
  store.hostRequest = (async () => ({ ok: false, code: "x", message: "no" })) as never;
  store.hostCommand = (async () => null) as never;
  const host = hostIn(status, withInfo);
  (store as unknown as { update(p: object): void }).update({ hosts: [host] });
  render(
    <TContext.Provider value={store.i18n.t}>
      <HostSettingsPanel
        store={store}
        host={host as never}
        hooksSection={null}
        onReconnect={() => {}}
        onRemove={() => {}}
        onOpenAutoApprovals={() => {}}
      />
    </TContext.Provider>,
  );
  return store;
}

/** What a person can do with `control`: "off" when an ancestor fieldset is disabled (a browser refuses the click). */
function state(control: HTMLElement | null) {
  if (control === null) return "missing";
  return control.closest("fieldset[disabled]") === null ? "live" : "off";
}

/** The state of each control of the panels the issue names, by its accessible name (English). */
const report = () => ({
  sleep: state(screen.queryByRole("combobox", { name: "Sleep idle sessions after" })),
  keepAwake: state(screen.queryByRole("button", { name: "Turn off" })),
  pause: state(screen.queryByRole("button", { name: "Pause new runs" })),
  resume: state(screen.queryByRole("switch", { name: "Resume automatically after a restart" })),
  bypass: state(screen.queryByRole("button", { name: "Allow sessions without prompts" })),
  autoUpdate: state(screen.queryByRole("checkbox", { name: "Update this host automatically" })),
  daemonUpdate: state(screen.queryByRole("button", { name: "Update daemon to 9.9.9" })),
});

const everyControl = (value: "off" | "live") => ({
  sleep: value,
  keepAwake: value,
  pause: value,
  resume: value,
  bypass: value,
  autoUpdate: value,
  daemonUpdate: value,
});

describe("the Settings tab of a host that is not online (#3870)", () => {
  test("every panel that acts on the host is disabled, so a click sends no command", () => {
    settings("offline");
    expect(report()).toEqual(everyControl("off"));
  });

  test("Reconnect and Remove host stay live", () => {
    settings("offline");
    const reconnect = state(screen.queryByRole("button", { name: "Reconnect" }));
    const remove = state(screen.queryByRole("button", { name: "Remove host" }));
    expect({ reconnect, remove }).toEqual({ reconnect: "live", remove: "live" });
  });

  test("an online host has no panel disabled", () => {
    settings("online");
    expect(report()).toEqual(everyControl("live"));
  });

  test.each([
    ["offline", "pi is offline: reconnect it to change this."],
    ["connecting", "pi is not connected yet: wait for it to answer."],
    ["unauthorized", "The host refused the token. Pair this host again."],
  ])("a %s host says why, and what it shows is the last known state", (status, reason) => {
    const store = settings(status);
    const text = document.body.textContent ?? "";
    const asOf = `Last known state, as of ${store.formatWhen("2026-11-20T10:42:00.000Z")}.`;
    expect([text.includes(reason), text.includes(asOf)]).toEqual([true, true]);
  });

  test("an incompatible host keeps Update the daemon live, the other panels off", () => {
    settings("incompatible");
    expect(report()).toEqual({ ...everyControl("off"), daemonUpdate: "live" });
    expect(document.body.textContent?.includes("Update the daemon on pi to change this.")).toBe(
      true,
    );
  });

  test("a host that never reported has nothing to date: the reason shows, the as-of line does not", () => {
    settings("offline", "en", false);
    const text = document.body.textContent ?? "";
    expect([
      text.includes("pi is offline: reconnect it to change this."),
      text.includes("as of"),
    ]).toEqual([true, false]);
  });

  test("a gate with no panel inside does not make its group appear", () => {
    settings("offline", "en", false);
    const groups = screen.queryAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(groups).toEqual(["Connection"]);
  });

  test("an app in Portuguese says it in Portuguese", () => {
    const store = settings("offline", "pt-BR");
    const text = document.body.textContent ?? "";
    expect([
      text.includes("pi está desconectado: reconecte-o para mudar isto."),
      text.includes(`Último estado conhecido, de ${store.formatWhen("2026-11-20T10:42:00.000Z")}.`),
    ]).toEqual([true, true]);
  });
});
