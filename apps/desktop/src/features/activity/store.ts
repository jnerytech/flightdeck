import type { ActivitySinceResult } from "@flightdeck/protocol";
import { hasFeature } from "../../lib/version.ts";

/** What one host said happened since the app was last active (issue #1344). */
export interface AwayHost {
  hostId: string;
  result: ActivitySinceResult;
}

export interface AwayState {
  /** When the app was last active, when it was away long enough to summarise; else null. */
  since: string | null;
  hosts: AwayHost[];
  /** Hosts that can say what happened but did not answer, by id, so the summary can name them. */
  unreached: string[];
  /** The person closed the summary; it stays closed until the next start. */
  dismissed: boolean;
}

/** The activity's part of the app's state (#1596). */
export interface ActivitySliceState {
  /** Issue #1344: what happened on the hosts while the app was closed. */
  away: AwayState;
}

/** A fresh initial state for each store: its arrays are never shared between stores. */
export const initialActivityState = (): ActivitySliceState => ({
  away: { since: null, hosts: [], unreached: [], dismissed: false },
});

/** What the activity reads and asks through the app's store. */
export interface ActivityCore {
  state(): ActivitySliceState & {
    hosts: ReadonlyArray<{
      id: string;
      status: string;
      hostInfo: { features?: readonly string[] } | null;
    }>;
  };
  update(patch: Partial<ActivitySliceState>): void;
  /** When the app was last active, when it was away long enough to summarise; else null. */
  since(): string | null;
  /** A host's `activity.since`. */
  request(
    hostId: string,
    since: string,
  ): Promise<{ ok: true; data: ActivitySinceResult } | { ok: false }>;
}

/** What happened on the hosts while the app was away (issue #1344; #1596: a slice of the store). */
export class ActivitySlice {
  /** Hosts already asked since the app started; one that did not answer is asked again. */
  private readonly awayAsked = new Set<string>();
  /** Hosts whose request is on its way. */
  private readonly awayInFlight = new Set<string>();
  /** Hosts that connected again while their request was on its way: that request may be a dead one. */
  private readonly awayAskAgain = new Set<string>();

  constructor(private readonly core: ActivityCore) {}

  /** Issue #1344: asks each online host with the feature what happened since the app was last active. */
  async loadAway(): Promise<void> {
    const since = this.core.since();
    const state = () => this.core.state();
    if (state().away.since !== since) this.core.update({ away: { ...state().away, since } });
    if (since === null) return;
    const online = state().hosts.filter(
      (h) => h.status === "online" && hasFeature(h.hostInfo?.features, "activity", false),
    );
    for (const host of online) if (this.awayInFlight.has(host.id)) this.awayAskAgain.add(host.id);
    const hosts = online.filter((h) => !this.awayAsked.has(h.id));
    for (const host of hosts) {
      this.awayAsked.add(host.id);
      this.awayInFlight.add(host.id);
    }
    const answers = await Promise.all(
      hosts.map(async (host) => ({
        hostId: host.id,
        asked: await this.core.request(host.id, since),
      })),
    );
    // A host that did not answer is named, and asked again the next time it connects; one that
    // connected again while it was asked is asked again now, and not named.
    const retry: string[] = [];
    for (const { hostId, asked: answer } of answers) {
      this.awayInFlight.delete(hostId);
      const again = this.awayAskAgain.delete(hostId);
      if (answer.ok) continue;
      this.awayAsked.delete(hostId);
      if (again) retry.push(hostId);
    }
    const found = answers.flatMap(({ hostId, asked: answer }) =>
      answer.ok ? [{ hostId, result: answer.data }] : [],
    );
    const failed = answers.flatMap(({ hostId, asked: answer }) =>
      answer.ok || retry.includes(hostId) ? [] : [hostId],
    );
    const answered = new Set(found.map((h) => h.hostId));
    const unreached = [
      ...state().away.unreached.filter((id) => !answered.has(id) && !failed.includes(id)),
      ...failed,
    ];
    this.core.update({
      away: { ...state().away, hosts: [...state().away.hosts, ...found], unreached },
    });
    if (retry.length > 0) await this.loadAway();
  }

  /** A removed host leaves the summary and is asked again if it is added back (#1733). */
  forget(_hostId: string): void {}

  /** Issue #1344: closes the summary until the next start. */
  dismissAway(): void {
    this.core.update({ away: { ...this.core.state().away, dismissed: true } });
  }
}
