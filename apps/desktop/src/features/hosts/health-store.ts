import type { DepsResult, DoctorResult } from "@flightdeck/protocol";
import { hasFeature } from "../../lib/version.ts";

/** How long a host's health read stays fresh: the sidebar and the host page ask again after it. */
export const HEALTH_MAX_AGE_MS = 5 * 60_000;

/** The hosts' health part of the app's state (#1596): what each host's checks found, and when. */
export interface HealthSliceState {
  /** What `deps.check` found on each host, by host id. */
  deps: Record<string, DepsResult>;
  /** What `doctor.run` found on each host, by host id. */
  doctor: Record<string, DoctorResult>;
  /** When each host's health (dependencies and doctor) was last read, in epoch milliseconds. */
  healthAt: Record<string, number>;
  /** Why the last read of a host's health failed, by host id; a good read clears it. */
  healthError: Record<string, string>;
}

/** A fresh initial state for each store: its records are never shared between stores. */
export const initialHealthState = (): HealthSliceState => ({
  deps: {},
  doctor: {},
  healthAt: {},
  healthError: {},
});

/** One answer of a host's health command: its data, or why the host refused. */
export type HealthAnswer<T> = { ok: true; data: T } | { ok: false; message: string };

/** What the health reads and ask through the app's store. */
export interface HealthCore {
  state(): HealthSliceState;
  update(patch: Partial<HealthSliceState>): void;
  /** The features a host announced; undefined before its info arrived. */
  features(hostId: string): readonly string[] | undefined;
  deps(hostId: string): Promise<HealthAnswer<DepsResult>>;
  /** The doctor of a host, run for this app's version. */
  doctor(hostId: string): Promise<HealthAnswer<DoctorResult>>;
  now(): number;
}

/** What each host's dependencies and doctor say (#1596: a slice of the store). */
export class HealthSlice {
  private readonly reads = new Map<string, Promise<void>>();
  /** Bumped when a host is removed: a read that began before it must not write back. */
  private readonly removals = new Map<string, number>();

  constructor(private readonly core: HealthCore) {}

  /**
   * Reads a host's whole health now: its dependencies and its doctor; the sidebar and the host page
   * read it. Silent (a failure goes to `healthError`, not to a banner), each half on its own, and a
   * read already on its way is the answer to a second ask.
   */
  check(hostId: string): Promise<void> {
    const running = this.reads.get(hostId);
    if (running) return running;
    const read = this.read(hostId).finally(() => {
      if (this.reads.get(hostId) === read) this.reads.delete(hostId);
    });
    this.reads.set(hostId, read);
    return read;
  }

  /** Reads it only when it was never read or is older than `maxAgeMs` (five minutes). */
  async ensure(hostId: string, maxAgeMs = HEALTH_MAX_AGE_MS): Promise<void> {
    const at = this.core.state().healthAt[hostId];
    if (at !== undefined && this.core.now() - at < maxAgeMs) return;
    await this.check(hostId);
  }

  /** Drops what a removed host left: its health data and a read on its way (#1733). */
  forget(hostId: string): void {
    this.removals.set(hostId, (this.removals.get(hostId) ?? 0) + 1);
    this.reads.delete(hostId);
    const { deps, doctor, healthAt, healthError } = this.core.state();
    const without = <T>(record: Record<string, T>): Record<string, T> =>
      Object.fromEntries(Object.entries(record).filter(([id]) => id !== hostId));
    this.core.update({
      deps: without(deps),
      doctor: without(doctor),
      healthAt: without(healthAt),
      healthError: without(healthError),
    });
  }

  private async read(hostId: string): Promise<void> {
    const features = this.core.features(hostId);
    const removals = this.removals.get(hostId);
    const [deps, doctor] = await Promise.all([
      hasFeature(features, "depsCheck", false) ? this.core.deps(hostId) : Promise.resolve(null),
      hasFeature(features, "doctor.run", false) ? this.core.doctor(hostId) : Promise.resolve(null),
    ]);
    if (this.removals.get(hostId) !== removals) return;
    // Every failed half says why, dependencies first; the older data of a failed half stays.
    const failures = [deps, doctor].flatMap((half) => (half && !half.ok ? [half.message] : []));
    const state = this.core.state();
    const { [hostId]: _gone, ...rest } = state.healthError;
    const got = deps?.ok ? deps.data : null;
    const heard = doctor?.ok ? doctor.data : null;
    this.core.update({
      ...(got ? { deps: { ...state.deps, [hostId]: got } } : {}),
      ...(heard ? { doctor: { ...state.doctor, [hostId]: heard } } : {}),
      // A failed read counts as a read: a host that refuses is not asked again within the max age.
      ...(deps || doctor ? { healthAt: { ...state.healthAt, [hostId]: this.core.now() } } : {}),
      healthError: failures.length > 0 ? { ...rest, [hostId]: failures.join("; ") } : rest,
    });
  }
}
