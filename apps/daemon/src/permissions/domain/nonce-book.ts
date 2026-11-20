import { FlightdeckError } from "../../kernel/index.ts";

/** What a nonce was issued for: an approval of one request, or an enrollment or a revoke (no request). */
export type NoncePurpose = "approve" | "enroll" | "revoke";

export interface NonceBookOptions {
  /** A monotonic clock in ms: a nonce's life never depends on the wall clock. */
  mono: () => number;
  /** A fresh unguessable text; the caller owns the entropy. */
  random: () => string;
  ttlMs?: number;
  /** Live nonces one connection may hold in a bucket (approvals, or enrollments and revokes). */
  perConnection?: number;
  /** Live nonces all connections may hold: approvals, and apart from them enrollments and revokes. */
  caps?: { approve: number; other: number };
}

export const NONCE_TTL_MS = 60_000;

interface Issued {
  purpose: NoncePurpose;
  requestId: string | undefined;
  connection: number;
  at: number;
}

/**
 * The challenges of the approval proof (#3439): each nonce is good once, for one purpose and, for an
 * approval, one request, for `ttlMs` on a monotonic clock. Several live at once per request. A connection
 * over its quota loses its own oldest nonce; a full bucket gives up its oldest expired nonce, then the
 * oldest of the connection asking, and otherwise refuses, so one client cannot starve another.
 */
export class NonceBook {
  /** In issue order: the first entry is the oldest. */
  private readonly live = new Map<string, Issued>();

  constructor(private readonly opts: NonceBookOptions) {}

  issue(purpose: NoncePurpose, requestId: string | undefined, connection: number): string {
    const bucket = bucketOf(purpose);
    const cap = this.opts.caps?.[bucket] ?? DEFAULT_CAPS[bucket];
    // At most half a bucket per connection, so a second connection always finds room.
    const quota = Math.max(
      1,
      Math.min(this.opts.perConnection ?? DEFAULT_PER_CONNECTION, Math.floor(cap / 2)),
    );
    const now = this.opts.mono();
    const inBucket = () => [...this.live].filter(([, n]) => bucketOf(n.purpose) === bucket);
    const mine = () => inBucket().filter(([, n]) => n.connection === connection);
    while (mine().length >= quota) this.live.delete(mine()[0]?.[0] ?? "");
    if (inBucket().length >= cap) {
      const dead = inBucket().find(([, n]) => now - n.at > this.ttl);
      const victim = dead ?? mine()[0];
      if (!victim) {
        throw new FlightdeckError(
          "invalid_state",
          "too many open challenges",
          "approval_challenge_busy",
        );
      }
      this.live.delete(victim[0]);
    }
    const nonce = this.opts.random();
    this.live.set(nonce, { purpose, requestId, connection, at: now });
    return nonce;
  }

  /** Uses the nonce up: `ok` once, `expired` past its life, `unknown` for any other (used, never issued, another purpose or request). */
  take(nonce: string, purpose: NoncePurpose, requestId?: string): "ok" | "expired" | "unknown" {
    const issued = this.live.get(nonce);
    if (!issued || issued.purpose !== purpose || issued.requestId !== requestId) return "unknown";
    this.live.delete(nonce);
    return this.opts.mono() - issued.at > this.ttl ? "expired" : "ok";
  }

  private get ttl(): number {
    return this.opts.ttlMs ?? NONCE_TTL_MS;
  }
}

const DEFAULT_CAPS = { approve: 256, other: 16 };
const DEFAULT_PER_CONNECTION = 16;

const bucketOf = (purpose: NoncePurpose): "approve" | "other" =>
  purpose === "approve" ? "approve" : "other";
