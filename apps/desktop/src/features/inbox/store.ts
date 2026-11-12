import { parseRequestLink } from "@/features/hosts/index.ts";
import type { T } from "../../i18n/index.ts";
import type { Route } from "../../lib/router.ts";
import type { Notification } from "../../platform/types.ts";
import {
  browserSound,
  decide,
  type NotifyPrefs,
  type NotifySource,
  playNotifySound,
} from "../notifications/index.ts";
import {
  addEntry,
  type InboxEntry,
  loadInbox,
  markAllRead,
  markRead,
  markUnread,
  saveInbox,
  unreadRows,
} from "./inbox.ts";
import type { AboutNotification } from "./notify.ts";

/** What the notification center reads and does through the app's store. */
export interface InboxCore {
  storage: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
  };
  /** The entries the state holds, and the way to change them (the screens read the state). */
  entries(): InboxEntry[];
  setEntries(entries: InboxEntry[]): void;
  /** What the person chose about notifications. */
  prefs(): NotifyPrefs;
  /** The sound file the person picked, when there is one. */
  soundFile(): string | null;
  /** The requests waiting for the person now, each as `host/request`. */
  waiting(): string[];
  hostOnline(hostId: string): boolean;
  now(): number;
  /** The system's notification; false when it was not shown. */
  show(notification: Notification): Promise<boolean>;
  /** The taskbar badge, where the platform has one. */
  setBadge(count: number): Promise<void> | undefined;
  t(): T;
}

/**
 * The notification center (#1596: a slice of the store): what the app sent, kept for the bell; who
 * is told (the bell, the system, the sound) by the person's choices; the taskbar badge; and which
 * requests were answered since they were sent.
 */
export class InboxSlice {
  /** The requests that waited at the last look, and every one this run has seen waiting (`host/request`). */
  private waitingBefore = new Set<string>();
  private readonly everWaiting = new Set<string>();
  /** What the taskbar badge shows now, so it is only told when the count changes. */
  private badgeShown = 0;

  constructor(private readonly core: InboxCore) {}

  /** Plays the notification sound; tests replace it. */
  soundPlayer: () => void = () =>
    playNotifySound(this.core.prefs().sound, this.core.soundFile(), browserSound());

  /** Reads what a previous run kept. */
  load(): void {
    this.core.setEntries(loadInbox(this.core.storage));
  }

  /** Sends an OS notification and keeps it in the notification center. */
  notify(
    notification: AboutNotification,
    route?: Route,
    fallbackUrl?: string | null,
    source?: NotifySource,
  ): void {
    const { about, event, ...n } = notification;
    const prefs = this.core.prefs();
    const decision = decide(prefs, source ?? { event: event ?? "other" }, this.core.now());
    if (!decision.bell && !decision.os) return;
    const entry: InboxEntry = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      title: n.title,
      body: n.body,
      ...(n.link ? { link: n.link } : {}),
      ...(route ? { route } : {}),
      ...(fallbackUrl ? { fallbackUrl } : {}),
      ...(about ? { subject: about.subject, host: about.host } : {}),
      ...(about?.ask ? { ask: about.ask } : {}),
      ...(about?.group ? { group: about.group } : {}),
      read: false,
    };
    if (decision.bell) this.setEntries(addEntry(this.core.entries(), entry));
    if (decision.os) void this.core.show(n);
    if (decision.sound && prefs.sound.mode !== "off") this.soundPlayer();
  }

  /** Remembers what waits, so a request that stops waiting is known to have been answered. */
  rememberWaiting(): void {
    const now = new Set(this.core.waiting());
    let changed = now.size !== this.waitingBefore.size;
    for (const key of now) {
      this.everWaiting.add(key);
      if (!this.waitingBefore.has(key)) changed = true;
    }
    this.waitingBefore = now;
    // The bell hides an answered request, so its count and the taskbar badge change with it.
    if (changed) this.syncBadge();
  }

  /**
   * Whether a request this run saw waiting is answered: it no longer waits and its host is up to say
   * so. One never seen waiting (answered while the app was closed) is not claimed to be answered.
   */
  requestAnswered(hostId: string, requestId: string): boolean {
    const key = `${hostId}/${requestId}`;
    if (!this.everWaiting.has(key) || this.waitingBefore.has(key)) return false;
    return this.core.hostOnline(hostId);
  }

  /** The bell's entries: a request answered since it was sent is not among them. */
  visible(): InboxEntry[] {
    return this.core.entries().filter((entry) => {
      const request = entry.link ? parseRequestLink(entry.link) : null;
      return !(request && this.requestAnswered(request.hostId, request.requestId));
    });
  }

  /** The bell's unread count as a taskbar badge, told only when it changes. */
  syncBadge(): void {
    const count = unreadRows(this.visible(), new Date(this.core.now()));
    if (count === this.badgeShown) return;
    this.badgeShown = count;
    // A taskbar that cannot show it is not worth a toast: the bell has the same count.
    void Promise.resolve(this.core.setBadge(count)).catch(() => {});
  }

  /** Tells the taskbar the badge again (it was lost), when there is one to show. */
  resendBadge(): void {
    if (this.badgeShown > 0)
      void Promise.resolve(this.core.setBadge(this.badgeShown)).catch(() => {});
  }

  /** Sends a notification of the app's own and says whether the system showed it. */
  async sendTest(): Promise<"delivered" | "blocked"> {
    const t = this.core.t();
    const shown = await this.core.show({
      title: t("notify.testTitle"),
      body: t("notify.testBody"),
    });
    if (shown) this.soundPlayer();
    return shown ? "delivered" : "blocked";
  }

  /** Marks entries unread again, for the person to come back to. */
  markUnread(ids: string | string[]): void {
    const wanted = new Set(typeof ids === "string" ? [ids] : ids);
    this.setEntries([...wanted].reduce((list, id) => markUnread(list, id), this.core.entries()));
  }

  /** Marks entries read: the one of a click, or every entry a collapsed row stands for. */
  markRead(ids: string | string[]): void {
    const wanted = new Set(typeof ids === "string" ? [ids] : ids);
    this.setEntries([...wanted].reduce((list, id) => markRead(list, id), this.core.entries()));
  }

  /** Drops entries: a notification about something that is gone. */
  dismiss(ids: string[]): void {
    const gone = new Set(ids);
    this.setEntries(this.core.entries().filter((e) => !gone.has(e.id)));
  }

  markAllRead(): void {
    this.setEntries(markAllRead(this.core.entries()));
  }

  clear(): void {
    this.setEntries([]);
  }

  private setEntries(entries: InboxEntry[]): void {
    this.core.setEntries(entries);
    this.syncBadge();
    saveInbox(this.core.storage, entries);
  }
}
