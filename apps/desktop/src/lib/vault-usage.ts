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

/** Phase 16: the vault's usage log in `storage`; what was asked of which secret, never its value. */
export class VaultUsageLog {
  constructor(_platform: Pick<Platform, "storage">, _options: UsageLogOptions = {}) {}

  list(_filter: UsageFilter = {}): UsageEntry[] {
    return [];
  }

  /** A delivered or refused request of the daemon. */
  recordOutcome(_outcome: VaultOutcome): UsageEntry {
    return {
      secretId: "",
      hostId: "",
      purpose: "",
      requester: "",
      at: 0,
      kind: "used",
      detail: "",
    };
  }

  /** The daemon's report that a delivered secret was used. */
  recordUsed(_hostId: string, _frame: VaultUsed): UsageEntry {
    return {
      secretId: "",
      hostId: "",
      purpose: "",
      requester: "",
      at: 0,
      kind: "delivered",
      detail: "",
    };
  }
}
