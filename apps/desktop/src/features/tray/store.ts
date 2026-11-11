import type { T } from "../../i18n/index.ts";
import type { AppState, PendingItem } from "../../lib/app-store.ts";
import { TRAY_MENU_DELAY_MS, trayMenu, trayStatus } from "../../lib/tray.ts";
import type { Platform, TrayAction, TrayStatus } from "../../platform/types.ts";

/** The part of the platform the tray and the window title need. */
export type TrayPlatform = Pick<
  Platform,
  "setTrayStatus" | "setTrayMenu" | "setTitle" | "onTrayAction" | "showMainWindow"
>;

/** What the tray and the title read of the app's state: the hosts and the requests seen so far. */
type TrayState = Pick<AppState, "hosts" | "sessions">;

/** The state fields whose change can alter the tray, the title or the menu. */
export type TrayPatch = Partial<
  Pick<
    AppState,
    "hosts" | "uiChoices" | "selected" | "externalRequests" | "externals" | "runs" | "cards"
  >
>;

/** What the tray reads and asks through the app's store. */
export interface TrayCore {
  state(): TrayState;
  /** The requests waiting for an answer, oldest first, worded in the current language. */
  needsYou(): PendingItem[];
  t(): T;
  /** The host the window shows (the selected one), if any. */
  uiHostId(): string | null;
  /** Whether a host is in simple mode: its requests are told in the plain sentence (issue #88). */
  isSimple(hostId: string): boolean;
  /** Answers a permission request on its host. */
  answer(hostId: string, requestId: string, decision: "allow" | "deny"): void;
  /** Brings a request to the window, where it is seen before it is answered. */
  open(item: PendingItem): void;
  timers: {
    setTimeout(fn: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
  };
}

/**
 * The tray and the window title (phase 8, issue #88; #1596: a slice of the store): the badge, the
 * "needs you" submenu and the title follow the app's state, and a click in the submenu answers a
 * request without the window.
 */
export class TraySlice {
  private status: TrayStatus | null = null;
  /** The submenu last sent, and the debounce that will send the next one. */
  private menuSent = JSON.stringify(trayMenu([]));
  private menuTimer: unknown = null;
  /** The title the window has now, so the platform is told only when it changes. */
  private titleShown = "Flightdeck";
  private offAction: (() => void) | null = null;

  constructor(
    private readonly platform: TrayPlatform,
    private readonly core: TrayCore,
  ) {}

  /** Listens to the submenu's clicks; a second start replaces the first listener. */
  start(): void {
    this.offAction?.();
    this.offAction = this.platform.onTrayAction((action) => this.act(action));
  }

  stop(): void {
    this.offAction?.();
    this.offAction = null;
  }

  /** A change in the state: the badge, the title and the submenu follow what it touched. */
  changed(patch: TrayPatch): void {
    if (patch.hosts || patch.uiChoices) this.syncStatus();
    if (
      patch.hosts ||
      patch.uiChoices ||
      patch.selected ||
      patch.externalRequests ||
      patch.externals ||
      patch.runs
    ) {
      this.syncTitle();
    }
    if (patch.hosts || patch.externalRequests || patch.externals || patch.runs || patch.cards) {
      this.scheduleMenu();
    }
  }

  /**
   * A new language: the tray's texts change at once (no debounce, the list did not change).
   * Rendering the screens again is the store's.
   */
  languageChanged(): void {
    this.syncStatus();
    this.syncTitle();
    const menu = this.menuNow();
    this.menuSent = JSON.stringify(menu);
    void this.platform.setTrayMenu(menu);
  }

  /** A click in the tray submenu: approve and deny answer without the window. */
  act({ key, action }: TrayAction): void {
    if (key === "more") {
      void this.platform.showMainWindow();
      return;
    }
    const item = this.core.needsYou().find((i) => `${i.hostId}/${i.requestId}` === key);
    if (!item) return;
    // The tray never approves a high-risk request: that takes holding the button in the app. A
    // workflow gate is answered on its card, never as a permission (the host refuses its id).
    // A vault grant is opened too (#244): the tray's line cannot show the secret and parameters.
    if (
      action === "open" ||
      item.gate ||
      (action === "approve" && (item.risk === "high" || item.vault))
    )
      this.core.open(item);
    else this.core.answer(item.hostId, item.requestId, action === "approve" ? "allow" : "deny");
  }

  /** Pushes the fleet-wide badge to the tray whenever it changes. */
  private syncStatus(): void {
    const { hosts, sessions } = this.core.state();
    // The requests the daemon approved by itself that the app has seen in its sessions.
    let autoApproved = 0;
    for (const session of Object.values(sessions)) {
      for (const item of session.items) {
        if (item.kind === "permission" && item.resolution?.auto) autoApproved++;
      }
    }
    const status = trayStatus(
      hosts.map((h) => ({ name: h.name, sessions: h.sessions, simple: this.core.isSimple(h.id) })),
      this.core.t(),
      autoApproved,
    );
    if (this.status?.label === status.label && this.status.tooltip === status.tooltip) return;
    this.status = status;
    void this.platform.setTrayStatus(status);
  }

  /**
   * The window shows one host (the selected one): in simple mode its title says how many tasks wait
   * for an answer; in full mode the title is left alone (issue #88).
   */
  private syncTitle(): void {
    const t = this.core.t();
    const hostId = this.core.uiHostId();
    let title = t("simple.windowTitle.idle");
    if (hostId && this.core.isSimple(hostId)) {
      const n = this.core.needsYou().filter((item) => item.hostId === hostId).length;
      if (n > 0) title = t("simple.windowTitle.waiting", { n });
    }
    if (title === this.titleShown) return;
    this.titleShown = title;
    void Promise.resolve(this.platform.setTitle?.(title)).catch(() => {});
  }

  /** The "needs you" menu now: a host in simple mode words its requests plainly (issue #88). */
  private menuNow() {
    return trayMenu(this.core.needsYou(), this.core.t(), (hostId) => this.core.isSimple(hostId));
  }

  /**
   * Rebuilds the submenu once the list stops changing for `TRAY_MENU_DELAY_MS`: each change
   * restarts the wait, and nothing is sent when the menu is the one already shown.
   */
  private scheduleMenu(): void {
    const { timers } = this.core;
    if (this.menuTimer !== null) timers.clearTimeout(this.menuTimer);
    this.menuTimer = null;
    if (JSON.stringify(this.menuNow()) === this.menuSent) return;
    this.menuTimer = timers.setTimeout(() => {
      this.menuTimer = null;
      const menu = this.menuNow();
      this.menuSent = JSON.stringify(menu);
      void this.platform.setTrayMenu(menu);
    }, TRAY_MENU_DELAY_MS);
  }
}
