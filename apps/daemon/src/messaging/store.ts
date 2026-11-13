/**
 * The messaging's rows (#1589): `session_messages`, the paused pairs and the stored policy. The
 * SQL lives here; `messages.ts` decides what to send and tells the app what changed.
 */
import type { Database } from "bun:sqlite";
import type { MessageInfo, MessageKind, RelayMessage } from "@flightdeck/protocol";
import { addressParts, type History, type Party } from "./policy.ts";
import { relayOf } from "./relay.ts";

/** A row of `session_messages`. */
export interface MessageRow {
  id: string;
  from_session: string;
  from_host: string;
  to_session: string;
  to_host: string;
  text: string;
  status: MessageInfo["status"];
  reason: string | null;
  created_at: string;
  created_ms: number;
  delivered_at: string | null;
  team_id: string | null;
  kind: MessageKind;
  sender: string | null;
  untrusted: number;
  relayed: number;
}

/** A message to record. */
export interface NewMessage {
  id: string;
  sender: Party;
  to: Party;
  text: string;
  status: MessageInfo["status"];
  reason: string | null;
  teamId: string | null;
  kind: MessageKind;
  untrusted: boolean;
  formatted: string | null;
  createdAt?: string;
}

/** How a message ended, as `update` records it. */
export interface MessagePatch {
  status: MessageInfo["status"];
  reason?: string | null;
  at: number;
  relayed?: boolean;
}

const iso = (ms: number): string => new Date(ms).toISOString();

const toInfo = (row: MessageRow): MessageInfo => ({
  id: row.id,
  fromSession: row.from_session,
  fromHost: row.from_host,
  toSession: row.to_session,
  toHost: row.to_host,
  text: row.text,
  status: row.status,
  reason: row.reason,
  createdAt: row.created_at,
  deliveredAt: row.delivered_at,
  teamId: row.team_id,
  kind: row.kind,
});

/** The statuses a sent message counts in the limits with. */
const COUNTED = "kind = 'session' AND status IN ('pending', 'delivered', 'queued')";

export class MessageStore {
  /** `host` is this host's name: the outbox holds what goes to the others. */
  constructor(
    private readonly db: Database,
    private readonly host: string,
  ) {}

  row(id: string): MessageRow | null {
    return this.db
      .query("SELECT * FROM session_messages WHERE id = ?")
      .get(id) as MessageRow | null;
  }

  /** Records a message at `now`; the stored message as the app sees it. */
  insert(input: NewMessage, now: number): MessageInfo {
    const delivered = input.status === "delivered" ? iso(now) : null;
    this.db
      .query(
        `INSERT INTO session_messages
           (id, from_session, from_host, to_session, to_host, text, status, reason, created_at,
            created_ms, delivered_at, team_id, kind, sender, untrusted, relayed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      )
      .run(
        input.id,
        input.sender.id,
        input.sender.host,
        input.to.id,
        input.to.host,
        input.text,
        input.status,
        input.reason,
        input.createdAt ?? iso(now),
        now,
        delivered,
        input.teamId,
        input.kind,
        JSON.stringify(input.sender),
        input.untrusted ? 1 : 0,
      );
    return toInfo(this.row(input.id) as MessageRow);
  }

  /** Records how a message ended; the stored message as the app sees it. */
  update(id: string, patch: MessagePatch): MessageInfo {
    this.db
      .query(
        `UPDATE session_messages
         SET status = ?1, reason = ?2,
             delivered_at = CASE WHEN ?1 = 'delivered' THEN ?3 ELSE delivered_at END,
             relayed = CASE WHEN ?4 = 1 THEN 1 ELSE relayed END
         WHERE id = ?5`,
      )
      .run(patch.status, patch.reason ?? null, iso(patch.at), patch.relayed ? 1 : 0, id);
    return toInfo(this.row(id) as MessageRow);
  }

  /** The messages for this host that were waiting in memory: lost when the daemon stops. */
  queuedHere(): string[] {
    return (
      this.db
        .query("SELECT id FROM session_messages WHERE status = 'queued' AND to_host = ?")
        .all(this.host) as Array<{ id: string }>
    ).map((row) => row.id);
  }

  /** Session messages from one session to another since `since`, that the limits count. */
  private countPair(
    fromHost: string,
    from: string,
    toHost: string,
    to: string,
    since: number,
  ): number {
    return (
      this.db
        .query(
          `SELECT COUNT(*) AS n FROM session_messages
           WHERE ${COUNTED}
             AND created_ms >= ? AND from_host = ? AND from_session = ? AND to_host = ? AND to_session = ?`,
        )
        .get(since, fromHost, from, toHost, to) as { n: number }
    ).n;
  }

  /** Session messages one session sent since `since`, that the limits count. */
  private countSent(host: string | null, session: string, since: number): number {
    return (
      this.db
        .query(
          `SELECT COUNT(*) AS n FROM session_messages
           WHERE ${COUNTED}
             AND created_ms >= ? AND from_host = ? AND from_session = ?`,
        )
        .get(since, host, session) as { n: number }
    ).n;
  }

  /** The counts the limits read. */
  history(): History {
    return {
      pair: (a, b, since) => {
        const x = addressParts(a);
        const y = addressParts(b);
        const [xh, yh] = [x.host as string, y.host as string];
        return {
          fromA: this.countPair(xh, x.id, yh, y.id, since),
          fromB: this.countPair(yh, y.id, xh, x.id, since),
        };
      },
      sent: (address, since) => {
        const x = addressParts(address);
        return this.countSent(x.host, x.id, since);
      },
    };
  }

  /** The newest messages since `since` that match the filter. */
  list(filter: {
    since: number;
    session: string | null;
    host: string | null;
    status: MessageInfo["status"] | null;
    team: string | null;
    limit: number;
  }): MessageInfo[] {
    const rows = this.db
      .query(
        `SELECT * FROM session_messages
         WHERE created_ms >= ?1
           AND (?2 IS NULL OR from_session = ?2 OR to_session = ?2)
           AND (?3 IS NULL OR from_host = ?3 OR to_host = ?3)
           AND (?4 IS NULL OR status = ?4)
           AND (?5 IS NULL OR team_id = ?5)
         ORDER BY created_ms DESC, rowid DESC LIMIT ?6`,
      )
      .all(
        filter.since,
        filter.session,
        filter.host,
        filter.status,
        filter.team,
        filter.limit,
      ) as MessageRow[];
    return rows.map(toInfo);
  }

  /** Messages waiting to cross to another host. */
  outbox(): RelayMessage[] {
    const rows = this.db
      .query(
        `SELECT * FROM session_messages
         WHERE kind = 'session' AND to_host <> ? AND status = 'queued' AND relayed = 0
         ORDER BY created_ms, rowid`,
      )
      .all(this.host) as MessageRow[];
    return rows.flatMap((row) => relayOf(row) ?? []);
  }

  /** The outbox messages created before `before`. */
  staleOutbox(before: number): string[] {
    return (
      this.db
        .query(
          `SELECT id FROM session_messages
           WHERE kind = 'session' AND to_host <> ? AND status = 'queued' AND relayed = 0 AND created_ms < ?`,
        )
        .all(this.host, before) as Array<{ id: string }>
    ).map((row) => row.id);
  }

  /** Drops the messages created before `before`. */
  prune(before: number): void {
    this.db.query("DELETE FROM session_messages WHERE created_ms < ?").run(before);
  }

  // --- the paused pairs ---

  pause(pair: string, at: string): void {
    this.db.query("INSERT OR IGNORE INTO messaging_paused (pair, at) VALUES (?, ?)").run(pair, at);
  }

  unpause(pair: string): void {
    this.db.query("DELETE FROM messaging_paused WHERE pair = ?").run(pair);
  }

  isPaused(pair: string): boolean {
    return this.db.query("SELECT 1 FROM messaging_paused WHERE pair = ?").get(pair) !== null;
  }

  pausedPairs(): string[] {
    return (
      this.db.query("SELECT pair FROM messaging_paused ORDER BY pair").all() as Array<{
        pair: string;
      }>
    ).map((row) => row.pair);
  }

  // --- the policy ---

  /** The stored policy, as JSON text; null when none was stored. */
  policy(): string | null {
    const stored = this.db.query("SELECT policy FROM messaging_config WHERE id = 1").get() as {
      policy: string;
    } | null;
    return stored ? stored.policy : null;
  }

  savePolicy(json: string): void {
    this.db
      .query(
        "INSERT INTO messaging_config (id, policy) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET policy = excluded.policy",
      )
      .run(json);
  }
}
