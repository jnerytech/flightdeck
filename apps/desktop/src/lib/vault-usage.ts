import type { VaultUsed } from "@flightdeck/protocol";
import type { Platform } from "../platform/types.ts";
import type { VaultOutcome } from "./vault-requests.ts";

/** What happened to a request: it was delivered, it was refused, or the daemon reported the use. */
export type UsageKind = "delivered" | "denied" | "used";

/** One line of the usage log; never holds a secret's value. */
export interface UsageEntry {
  secretId: string;
  hostId: string;
  purpose: string;
  requester: string;
  at: number;
  kind: UsageKind;
  /** Why it was refused, or what the use did. */
  detail: string;
}

export interface UsageFilter {
  secretId?: string;
  hostId?: string;
  requester?: string;
  purpose?: string;
  kind?: UsageKind;
}

export interface UsageLogOptions {
  clock?: () => number;
  /** The log keeps this many lines, the newest. */
  limit?: number;
}

const LOG_KEY = "flightdeck.vault-usage";
const DEFAULT_LIMIT = 500;

/** Phase 16: the vault's usage log in `storage`; what was asked of which secret, never its value. */
export class VaultUsageLog {
  constructor(
    private readonly platform: Pick<Platform, "storage">,
    private readonly options: UsageLogOptions = {},
  ) {}

  /** Newest first. */
  list(filter: UsageFilter = {}): UsageEntry[] {
    const raw = this.platform.storage.getItem(LOG_KEY);
    const all = raw ? (JSON.parse(raw) as UsageEntry[]) : [];
    return all
      .filter((e) =>
        (Object.keys(filter) as Array<keyof UsageFilter>).every(
          (k) => filter[k] === undefined || e[k] === filter[k],
        ),
      )
      .reverse();
  }

  private append(entry: UsageEntry): UsageEntry {
    const raw = this.platform.storage.getItem(LOG_KEY);
    const all = raw ? (JSON.parse(raw) as UsageEntry[]) : [];
    const kept = [...all, entry].slice(-(this.options.limit ?? DEFAULT_LIMIT));
    this.platform.storage.setItem(LOG_KEY, JSON.stringify(kept));
    return entry;
  }

  /** A delivered or refused request of the daemon. */
  recordOutcome(outcome: VaultOutcome): UsageEntry {
    return this.append({
      secretId: outcome.secretId,
      hostId: outcome.hostId,
      purpose: outcome.purpose,
      requester: outcome.requester,
      at: (this.options.clock ?? Date.now)(),
      kind: outcome.delivered ? "delivered" : "denied",
      detail: outcome.delivered ? "" : outcome.reason,
    });
  }

  /** The daemon's report that a delivered secret was used. */
  recordUsed(hostId: string, frame: VaultUsed): UsageEntry {
    return this.append({
      secretId: frame.secretId,
      hostId,
      purpose: frame.purpose,
      requester: frame.requester,
      at: Date.parse(frame.at),
      kind: "used",
      detail: frame.action,
    });
  }
}
