import type { HostTabs } from "../features/hosts/index.ts";
import { type SessionViews, sessionKey } from "../features/sessions/index.ts";
import { type Tabs, Workspace } from "../features/tabs/index.ts";
import type { T } from "../i18n/index.ts";
import type { AppState } from "../lib/app-state.ts";

interface TabWindowDeps {
  hostTabs: HostTabs;
  state: () => AppState;
  update: (patch: Partial<AppState>) => void;
  sessionViews: SessionViews;
  /** Closes the shell a session page opened on its host. */
  closeShell: (hostId: string, terminalId: string) => void;
  /** The host the window shows, when the tabs name none yet (after a reload). */
  uiHostId: () => string | null;
  translate: () => T;
  success: (text: string, link: { label: string; run: () => void }) => void;
}

/** What the window shows: the current host's tabs, the shared tabs, and what a tab change touches. */
export class TabWindow {
  /** What the window shows while there is no host and no shared tab: never kept. */
  private readonly noHost = new Workspace({ name: "start" });

  constructor(private readonly deps: TabWindowDeps) {}

  /** The current host's window (its tabs and split); an empty one with no host. */
  get workspace(): Workspace {
    return this.deps.hostTabs.workspace ?? this.noHost;
  }

  /** The tabs in use: the shared ones while a shared tab is active or with no host, else the host's focused area. */
  get tabs(): Tabs {
    const { hostTabs } = this.deps;
    return hostTabs.onShared || !hostTabs.workspace ? hostTabs.shared : this.workspace.tabs;
  }

  /** The host the switcher shows: the active tab's, or the last one used on a shared tab. */
  activeHostId(): string | null {
    return this.deps.hostTabs.hostId;
  }

  /** A new tab; the host tabs choose where (`HostTabs.openNew`). */
  openNewTab(): void {
    this.deps.hostTabs.openNew(this.deps.state().hosts);
  }

  /** Closes a tab; a terminal's waits in `closingTerminal` for detach or end. */
  closeTab(area: Tabs, tabId: string): void {
    const tab = area.tabs.find((candidate) => candidate.id === tabId);
    const route = tab?.router.current;
    if (route?.name === "terminal") {
      this.deps.update({ closingTerminal: { areaId: area.id, tabId } });
      return;
    }
    // Issue #107: the shell a session page opened lives as long as its tab.
    if (route?.name === "session") {
      const key = sessionKey(route.host, route.id);
      const terminalId = this.deps.sessionViews.terminalOf(key);
      if (terminalId) {
        this.deps.sessionViews.setTerminal(key, null);
        this.deps.closeShell(route.host, terminalId);
      }
    }
    area.close(tabId);
  }

  /** The sessions an area shows right now (the active tab of each area), by session key. */
  shownSessions(): Set<string> {
    const shown = new Set<string>();
    if (this.deps.hostTabs.onShared) return shown;
    for (const area of this.workspace.areas) {
      const route = area.router.current;
      if (route.name === "session") shown.add(sessionKey(route.host, route.id));
    }
    return shown;
  }

  /** A session on screen is read. */
  clearShownUnread(): void {
    const { unread } = this.deps.state();
    const shown = [...this.shownSessions()].filter((key) => unread[key]);
    if (shown.length === 0) return;
    const rest = { ...unread };
    for (const key of shown) delete rest[key];
    this.deps.update({ unread: rest });
  }

  /** A navigation took the window to another host's tabs (#932): say so, with the way back. */
  announceSwitch(left: string | null, to: string): void {
    // With no tabs' host yet (after a reload), the switcher named the window's host: the same
    // host is no switch. With no host at all (a first page, a deep link), nothing was left.
    const from = left ?? this.deps.uiHostId();
    if (!from || from === to) return;
    const t = this.deps.translate();
    const name = (id: string) => this.deps.state().hosts.find((host) => host.id === id)?.name ?? id;
    this.deps.success(t("toast.switchedHost", { host: name(to) }), {
      label: t("toast.backTo", { host: name(from) }),
      run: () => this.deps.hostTabs.returnAcross(left),
    });
  }
}
