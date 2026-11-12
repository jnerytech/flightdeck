import { describe, expect, test } from "bun:test";
import { hostColorVar } from "../../src/features/hosts/host-color.ts";
import { TAB_ICONS, tabFacts, tabTitle } from "../../src/features/tabs/tab-facts.ts";
import type { Tab } from "../../src/features/tabs/tabs.ts";
import { translator } from "../../src/i18n/index.ts";
import type { AppState, AppStore } from "../../src/lib/app-store.ts";
import { type Route, Router } from "../../src/lib/router.ts";

const t = translator("en");

const tab = (route: Route, over: Partial<Tab> = {}): Tab => ({
  id: "t1",
  router: new Router(route),
  pinned: false,
  preview: false,
  ...over,
});

const state = (over: object = {}) =>
  ({
    hosts: [
      {
        id: "h1",
        name: "alpha",
        sessions: [
          {
            id: "s1",
            cwd: "/work/api",
            status: "running",
            pendingPermissions: [],
            updatedAt: "2026-11-11T10:00:00Z",
          },
          {
            id: "s2",
            cwd: "/work/web",
            status: "idle",
            pendingPermissions: [],
            updatedAt: "2026-11-11T09:00:00Z",
          },
        ],
      },
    ],
    unread: {},
    projects: {},
    externals: {},
    meta: {},
    hub: {},
    ...over,
  }) as unknown as AppState;

const store = (terminals: [string, { name: string; tags: string[] }][] = []) =>
  ({ i18n: { t }, ssh: { terminals: new Map(terminals) } }) as unknown as AppStore;

const ssh = store([["h1/term1", { name: "build box", tags: ["prod"] }]]);
const terminalTab = tab({ name: "terminal", host: "h1", terminalId: "term1" });

describe("tab-facts: the title of a tab", () => {
  test("a terminal opened from an ssh destino says the destino's name", () => {
    expect(tabTitle(terminalTab, state(), ssh)).toBe(
      t("terminalUi.sshBadge", { name: "build box" }),
    );
    expect(tabFacts(terminalTab, { t, state: state(), store: ssh, host: null }).ssh).toEqual({
      name: "build box",
      tags: ["prod"],
    });
  });

  test("a terminal that no destino opened has no ssh facts", () => {
    const none = { t, state: state(), store: store(), host: null };
    expect(tabFacts(terminalTab, none).ssh).toBeUndefined();
    expect(tabFacts(tab({ name: "overview" }), { ...none, store: ssh }).ssh).toBeUndefined();
  });

  test("a host's overview and history show their section, not the host's name", () => {
    expect(tabTitle(tab({ name: "host", host: "h1" }), state(), store())).toBe(
      t("hostHome.overview"),
    );
    expect(tabTitle(tab({ name: "history", host: "h1" }), state(), store())).toBe(
      t("sidebar.history"),
    );
  });

  test("any other screen shows the last step of its header path", () => {
    expect(tabTitle(tab({ name: "overview" }), state(), store())).toBe(t("nav.overview"));
    expect(tabTitle(tab({ name: "costs" }), state(), store())).toBe(t("sidebar.costs"));
  });
});

describe("tab-facts: what the strip shows and says about a tab", () => {
  const at = (host: string | null, over: Partial<Parameters<typeof tabFacts>[1]> = {}) => ({
    t,
    state: state(),
    store: store(),
    host,
    ...over,
  });

  test("a running session of a host: its kind, badge, icon, host color and a named aria label", () => {
    const facts = tabFacts(tab({ name: "session", host: "h1", id: "s1" }), at("h1"));
    expect(facts.kind).toBe("session");
    expect(facts.Icon).toBe(TAB_ICONS.session);
    expect(facts.badge).toBe("running");
    expect(facts.hostColor).toBe(hostColorVar("h1"));
    expect(facts.ariaLabel).toBe(
      t("tabs.named", { title: `${facts.label}, ${t("tabs.badge.running")}`, host: "alpha" }),
    );
  });

  test("an idle session says since when its prompt cache has run", () => {
    const facts = tabFacts(tab({ name: "session", host: "h1", id: "s2" }), at("h1"));
    expect(facts.cacheSince).toBe("2026-11-11T09:00:00Z");
    expect(facts.badge).toBeNull();
  });

  test("a pinned tab of no host has no title on screen, so its aria label carries the badge's words", () => {
    const pinned = tab({ name: "session", host: "h1", id: "s1" }, { pinned: true });
    const facts = tabFacts(pinned, at(null));
    expect(facts.hostColor).toBeUndefined();
    expect(facts.ariaLabel).toBe(`${facts.label}, ${t("tabs.badge.running")}`);
    const plain = tabFacts(pinned, at(null, { state: state({ hosts: [] }) }));
    expect(plain.badge).toBeNull();
    expect(plain.ariaLabel).toBe(plain.label);
  });

  test("an unpinned tab of no host needs no aria label", () => {
    expect(tabFacts(tab({ name: "overview" }), at(null)).ariaLabel).toBeUndefined();
  });

  test("a host the state does not know is named by its id", () => {
    const facts = tabFacts(tab({ name: "overview" }), at("ghost"));
    expect(facts.ariaLabel).toBe(t("tabs.named", { title: facts.label, host: "ghost" }));
  });

  test("a terminal from a production destino is marked prod", () => {
    const facts = tabFacts(terminalTab, at("h1", { store: ssh }));
    expect(facts.prod).toBe(true);
    expect(facts.ssh).toEqual({ name: "build box", tags: ["prod"] });
    const staging = store([["h1/term1", { name: "stage", tags: ["staging"] }]]);
    expect(tabFacts(terminalTab, at("h1", { store: staging })).prod).toBe(false);
    expect(tabFacts(tab({ name: "overview" }), at("h1")).prod).toBeUndefined();
  });
});
