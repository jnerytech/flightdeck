import type { CommandResults, HostInfoResult } from "@flightdeck/protocol";
import type { T } from "../../i18n/index.ts";
import { APP_VERSION, isNewer } from "../../lib/version.ts";

/** The least time between two checks the app starts by itself for one host. */
export const AUTO_UPDATE_CHECK_MS = 10 * 60_000;

/** How long a host may take to come back on the new version before the page says it is late. */
export const DAEMON_UPDATE_TIMEOUT_MS = 120_000;

/** What the daemon update reads and writes of a host (#1596): its status, info and update marks. */
export interface HostUpdateView {
  status: string;
  /** From `host.info`; `null` until it arrives or on daemons without it. */
  hostInfo: HostInfoResult | null;
  /** Phase 9: an update of the daemon asked from the app, until it comes back on `target`. */
  daemonUpdate: { target: string; failed: string | null } | null;
  /** The daemon's update check asked for from the app: running, or why it did not run. */
  updateCheck: { busy: boolean; failed: string | null } | null;
}

/** The marks a host's update leaves on its view. */
export type HostUpdatePatch = Partial<
  Pick<HostUpdateView, "hostInfo" | "daemonUpdate" | "updateCheck">
>;

/** What the daemon update reads and asks through the app's store. */
export interface HostUpdateCore {
  host(hostId: string): HostUpdateView | undefined;
  patch(hostId: string, patch: HostUpdatePatch): void;
  /** False when the host has no connection open. */
  connected(hostId: string): boolean;
  /** Asks the daemon to apply its update; rejects when it refuses. */
  apply(hostId: string): Promise<unknown>;
  /** Asks the daemon to check for an update now; rejects when it cannot. */
  check(hostId: string): Promise<CommandResults["daemon.update.check"]>;
  /** The text of a failed request, as the page shows it. */
  describeError(error: unknown): string;
  t(): T;
  now(): number;
  /** How long a host may take to come back; the store's option, else the default. */
  timeoutMs?: number;
}

/** A host's daemon update: asked for, checked, and watched until it comes back (#1596: a slice). */
export class HostUpdateSlice {
  /** When the page last asked each host for an update check on its own. */
  private readonly autoChecks = new Map<string, number>();

  constructor(private readonly core: HostUpdateCore) {}

  /**
   * Phase 9: asks the host's daemon to apply its update. The host shows "atualizando…" until it
   * reconnects on the new version; past the time limit, or on a refusal, it shows why.
   */
  async apply(hostId: string): Promise<void> {
    const target = this.core.host(hostId)?.hostInfo?.update?.version;
    if (!target || !this.core.connected(hostId)) return;
    this.core.patch(hostId, { daemonUpdate: { target, failed: null } });
    const fail = (failed: string) => {
      if (this.core.host(hostId)?.daemonUpdate?.target === target)
        this.core.patch(hostId, { daemonUpdate: { target, failed } });
    };
    try {
      await this.core.apply(hostId);
    } catch (error) {
      fail((error as Error).message);
      return;
    }
    setTimeout(
      () => fail(this.core.t()("messages.daemonUpdateLate", { version: target })),
      this.core.timeoutMs ?? DAEMON_UPDATE_TIMEOUT_MS,
    );
  }

  /** Asks the host's daemon to check for an update now (`daemon.update.check`). */
  async check(hostId: string): Promise<void> {
    if (!this.core.connected(hostId)) return;
    this.core.patch(hostId, { updateCheck: { busy: true, failed: null } });
    try {
      const update = await this.core.check(hostId);
      const info = this.core.host(hostId)?.hostInfo;
      this.core.patch(hostId, { updateCheck: null, hostInfo: info ? { ...info, update } : info });
    } catch (error) {
      const failed = this.core.describeError(error);
      this.core.patch(hostId, { updateCheck: { busy: false, failed } });
    }
  }

  /** The same check, once when the app is newer than the daemon, at most once per 10 minutes. */
  async autoCheck(hostId: string): Promise<void> {
    const host = this.core.host(hostId);
    const info = host?.hostInfo;
    if (host?.status !== "online" || !info?.update) return;
    if (!isNewer(APP_VERSION, info.daemonVersion)) return;
    const last = this.autoChecks.get(hostId);
    const now = this.core.now();
    if (last !== undefined && now - last < AUTO_UPDATE_CHECK_MS) return;
    this.autoChecks.set(hostId, now);
    await this.check(hostId);
  }
}
