import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { DepResult, DepsResult } from "@flightdeck/protocol";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settle } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { HostPage } = await import("../src/ui/HostPage.tsx");
const { TContext } = await import("../src/i18n/context.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const dep = (
  id: DepResult["id"],
  group: DepResult["group"],
  state: DepResult["state"],
  breaks: DepResult["breaks"] = [],
): DepResult => ({ id, group, state, breaks, fix: [{ os: "linux", command: `install ${id}` }] });
const DEPS: DepsResult = {
  items: [
    dep("folders", "required", "missing", ["sessions"]),
    dep("hooks", "optional", "missing", ["liveStatus"]),
  ],
};
const host = {
  id: "h1",
  name: "pc",
  url: "ws://x",
  token: "",
  status: "online",
  info: null,
  hostInfo: {
    os: "linux",
    arch: "x64",
    daemonVersion: "0.36.0",
    claudeVersion: null,
    activeSessions: 0,
    uptimeSec: 5,
    features: ["central", "depsCheck", "doctor.run"],
  },
  infoAt: 0,
  latencyMs: null,
  incompatibility: null,
  daemonUpdate: null,
  sessions: [],
};

function setup() {
  const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  const internals = store as unknown as { update(p: object): void };
  internals.update({
    hosts: [host],
    deps: { h1: DEPS },
    doctor: { h1: { ok: true, checks: [] } },
    healthAt: { h1: Date.now() },
  });
  store.loadPalette = async () => {};
  store.refreshHub = (async () => {}) as never;
  store.checkHealth = (async () => {}) as never;
  const asked: string[] = [];
  let installed = false;
  store.hostCommand = (async (_host: string, type: string) => {
    asked.push(type);
    if (type === "hooks.install") installed = true;
    if (type === "hooks.status" || type === "hooks.install") {
      return {
        status: installed ? "installed" : "absent",
        settingsPath: "~/.claude/settings.json",
      };
    }
    return null;
  }) as never;
  store.hostRequest = (async () => ({ ok: false, code: "x", message: "no" })) as never;
  render(
    <TContext.Provider value={store.i18n.t}>
      <HostPage
        store={store}
        host={host as never}
        onRename={() => null}
        onReconnect={() => {}}
        onOpenAutoApprovals={() => {}}
        onOpenHistory={() => {}}
        onOpenSession={() => {}}
        onOpenProject={() => {}}
        onSeeAllSessions={() => {}}
        onSeeAllProjects={() => {}}
        onNewSession={() => {}}
        onRemove={() => {}}
      />
    </TContext.Provider>,
  );
  return { store, asked };
}

const health = () => screen.getByRole("region", { name: "Health & dependencies" });
const healthRow = (name: string) => within(health()).getByRole("listitem", { name });
const click = (el: Element) =>
  act(async () => {
    fireEvent.click(el);
  });

describe("host-saude-foco: the one-click fixes of the Health section (issue #206)", () => {
  test("Add folder opens Settings with the folder field focused and in view", async () => {
    const scrolled: Element[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    try {
      setup();
      await click(within(healthRow("Allowed folders")).getByRole("button", { name: "Add folder" }));
      const field = screen.getByLabelText("Folder to allow");
      await settle(() => document.activeElement === field);
      expect(document.activeElement).toBe(field);
      expect(scrolled).toContain(field);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  test("Install hooks from the Health row refreshes the hooks status of the Settings tab", async () => {
    setup();
    const settings = () => screen.getByRole("region", { name: "Claude Code hooks" });
    await settle(() => (settings().textContent ?? "").includes("absent"));
    expect(settings().textContent).toContain("absent");
    await click(
      within(healthRow("Claude Code hooks")).getByRole("button", { name: "Install hooks" }),
    );
    await click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Install hooks" }),
    );
    await settle(() => (settings().textContent ?? "").includes("installed"));
    expect(settings().textContent).not.toContain("absent");
  });
});
