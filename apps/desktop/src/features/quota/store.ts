import type { QuotaState } from "@flightdeck/protocol";
import type { Key, T } from "../../i18n/index.ts";
import { QuotaNotices } from "./notices.ts";

/** The plan quota's part of the app's state (#1596): each host's windows and its pause guard. */
export interface QuotaSliceState {
  /** Plan quota of each host, by host id; kept by `quota.updated`. */
  quota: Record<string, QuotaState>;
}

/** A fresh initial state for each store: its record is never shared between stores. */
export const initialQuotaState = (): QuotaSliceState => ({ quota: {} });

/** A notice the quota raises, for the app to deliver to the person. */
export interface QuotaNotice {
  title: string;
  body: string;
}

/** What the quota reads and asks through the app's store; a refusal comes back `null`. */
export interface QuotaCore {
  state(): QuotaSliceState;
  update(patch: Partial<QuotaSliceState>): void;
  /** The hosts the app is connected to right now, by id. */
  onlineHosts(): string[];
  /** A host's display name; undefined for a host the app no longer lists. */
  hostName(hostId: string): string | undefined;
  /** Asks a host for its plan quota (`quota.get`). */
  read(hostId: string): Promise<QuotaState | null>;
  /** Sets a host's "new cards wait from N%" guard (`quota.setPauseAt`). */
  setPauseAt(hostId: string, pauseAt: number | null): Promise<QuotaState | null>;
  /** Tells the person, on the route of the host. */
  notify(notice: QuotaNotice, hostId: string): void;
  t(): T;
  now(): number;
}

/** The plan quota of each host: kept as the hosts report it, and told once per account, window and level. */
export class QuotaSlice {
  /** Quota windows already notified, by host, window and reset. */
  private readonly notices = new QuotaNotices();

  constructor(private readonly core: QuotaCore) {}

  /** Asks every online host for its plan quota again (the status bar's refresh); a host that does not answer keeps what it had. */
  async refresh(): Promise<void> {
    await Promise.all(
      this.core.onlineHosts().map((hostId) =>
        this.core.read(hostId).then(
          (state) => {
            if (state) this.updated(hostId, state);
          },
          () => {},
        ),
      ),
    );
  }

  /**
   * Sets the guard "new cards wait from N%" on a host (`null` turns it off); the host's answer is its
   * new quota state. A refusal goes to the banner and leaves the guard as it was.
   */
  async setPause(hostId: string, pauseAt: number | null): Promise<void> {
    const state = await this.core.setPauseAt(hostId, pauseAt);
    if (state) this.updated(hostId, state);
  }

  /** Crossing `pauseAt` (and 95%, and the plan's refusal) notifies once per account, window and reset. */
  updated(hostId: string, state: QuotaState): void {
    this.core.update({ quota: { ...this.core.state().quota, [hostId]: state } });
    const hostName = this.core.hostName(hostId);
    for (const window of state.windows) {
      if (hostName === undefined || !this.notices.check(window, state.pauseAt, this.core.now())) {
        continue;
      }
      const t = this.core.t();
      const known = window.window === "five_hour" || window.window === "seven_day";
      const label = known ? t(`quota.windows.${window.window}` as Key) : window.window;
      const percent = Math.round((window.utilization ?? 0) * 100);
      this.core.notify(
        {
          title: t("notify.quotaTitle"),
          body: t("notify.quotaBody", { host: hostName, window: label, percent }),
        },
        hostId,
      );
    }
  }
}
