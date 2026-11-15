/**
 * Phase 21: messages between sessions. On one host the daemon delivers straight to the session and
 * needs no app; between hosts the app carries the message from the daemon of the sender to the
 * daemon of the recipient, and until it does the message waits in the sender's outbox for 24 hours.
 * Every message is a row of `session_messages` for the conversations screen.
 */
import type { Database } from "bun:sqlite";
import type {
  MessageInfo,
  MessagingSession,
  ReadSessionResult,
  RelayMessage,
  SendResult,
  SessionIdentity,
} from "@flightdeck/protocol";
import { z } from "zod";
import { FlightdeckError, parseJsonOr, ulid } from "../kernel/index.ts";
import { Delivery } from "./delivery.ts";
import { Directory, type NameBook, type Target } from "./directory.ts";
import { formatSessionMessage, formatSystemMessage } from "./domain/header.ts";
import { blankParty, relayAnswer, sharedTeam } from "./domain/parties.ts";
import {
  DAY_MS,
  FLIGHTDECK,
  type ListedSession,
  type MessagingFrame,
  OUTBOX_MS,
  type Params,
  type PeerSession,
  pairKey,
} from "./domain/peers.ts";
import {
  access,
  addressOf,
  addressParts,
  DEFAULT_POLICY,
  limits,
  type Party,
  type Policy,
  sizeError,
  validatePolicy,
} from "./domain/policy.ts";
import { relayOf } from "./domain/relay.ts";
import type { EndpointInfo, Endpoints } from "./endpoints.ts";
import { type MessagePatch, type MessageRow, MessageStore, type NewMessage } from "./store.ts";

// The tests build frames and peers from these; the entry does not export them.
export type { ListedSession, MessagingFrame, PeerSession } from "./domain/peers.ts";

export interface MessagingOptions {
  db: Database;
  /** This host's name, the first half of every address. */
  host: string;
  endpoints: Endpoints;
  clock?: () => number;
  /** The team a session belongs to, if any. */
  teamOf?: (sessionId: string) => string | null;
  /** The persona badge of a session (phase 20); the endpoint's own when absent. */
  personaOf?: (sessionId: string) => string | null;
  /** The standard names of the sessions: their aliases address them. */
  names?: NameBook;
}

const bad = (message: string, reason: string, params?: Params) =>
  new FlightdeckError("bad_request", message, reason, params);

export class Messaging {
  private readonly listeners = new Set<(frame: MessagingFrame) => void>();
  private policy: Policy;
  private readonly dir: Directory;
  private readonly delivery: Delivery;
  private readonly store: MessageStore;

  constructor(private readonly opts: MessagingOptions) {
    this.store = new MessageStore(opts.db, opts.host);
    const stored = this.store.policy();
    // A stored policy that is not JSON reads as none: the default applies, as for a new host.
    this.policy =
      stored !== null
        ? validatePolicy(parseJsonOr(z.unknown(), stored, undefined)).policy
        : DEFAULT_POLICY;
    // What was waiting in memory when the daemon stopped cannot be delivered any more.
    for (const id of this.store.queuedHere()) {
      this.update(id, {
        status: "expired",
        reason: "the daemon restarted before delivery",
        at: this.ms(),
      });
    }
    this.dir = new Directory({
      host: opts.host,
      endpoints: opts.endpoints,
      policy: () => this.policy,
      teamOf: opts.teamOf,
      personaOf: opts.personaOf,
      names: opts.names,
    });
    this.delivery = new Delivery({
      endpoints: opts.endpoints,
      settle: (id, patch) => this.update(id, { ...patch, at: this.ms() }),
    });
  }

  private ms(): number {
    return (this.opts.clock ?? Date.now)();
  }

  private iso(ms: number): string {
    return new Date(ms).toISOString();
  }

  watch(listener: (frame: MessagingFrame) => void): () => void {
    this.listeners.add(listener);
    // The app that reconnects is handed what is still waiting to cross.
    for (const message of this.outbox()) listener({ type: "messages.relay", message });
    return () => this.listeners.delete(listener);
  }

  private emit(frame: MessagingFrame): void {
    for (const listener of this.listeners) listener(frame);
  }

  // --- who is who (the directory) ---

  /** Every session of this host, unfiltered, for the app to hand to the other daemons. */
  directory(): ListedSession[] {
    return this.dir.listing();
  }

  setPeers(host: string, sessions: PeerSession[]): void {
    this.dir.setPeers(host, sessions);
  }

  /** Who a session identity is (throws when the daemon does not know it). */
  whoIs(as: SessionIdentity): Party {
    return this.dir.resolve(as);
  }

  /** The sessions the asker may see, by the rules. */
  sessions(as: SessionIdentity): MessagingSession[] {
    return this.dir.sessions(as);
  }

  /**
   * Who asks and about whom, under the rules (for the idle notice and for reading a session): throws
   * the reason when the asker is unknown, the target is not found or the rules do not let them.
   * `info` is null for a session of another host.
   */
  inspect(
    as: SessionIdentity,
    address: string,
  ): { sender: Party; target: Party; info: EndpointInfo | null } {
    return this.dir.inspect(as, address);
  }

  /** `read_session`: the summary and the last messages of a session this one may see. */
  read(as: SessionIdentity, address: string, last = 10): Promise<ReadSessionResult> {
    return this.dir.read(as, address, last);
  }

  // --- sending ---

  send(input: { as: SessionIdentity; to: string; text: string }): SendResult {
    const sender = this.dir.resolve(input.as);
    const untrusted = this.opts.endpoints.untrusted(sender.id);
    const target = this.dir.target(input.to);
    if ("error" in target) {
      return this.refused(sender, input.to, input.text, target.error, untrusted);
    }
    const verdict = this.check(sender, target, input.text);
    if (verdict) {
      return this.refused(
        sender,
        addressOf(target.party),
        input.text,
        verdict,
        untrusted,
        target.party,
      );
    }

    const id = ulid(this.ms());
    const teamId = sharedTeam(sender, target.party);
    const record = (status: MessageInfo["status"], formatted: string | null) =>
      this.insert({
        id,
        sender,
        to: target.party,
        text: input.text,
        status,
        reason: null,
        teamId,
        kind: "session",
        untrusted,
        formatted,
      });
    if (!target.local) {
      // Another host: the app carries it. Until it does, it waits here.
      record("queued", null);
      const relay = relayOf(this.store.row(id) as MessageRow);
      if (relay) this.emit({ type: "messages.relay", message: relay });
      return { id, status: "queued", reason: null };
    }
    const formatted = formatSessionMessage(sender, input.text, untrusted);
    const outcome = this.delivery.handOver(target.local, id, formatted);
    if ("refusal" in outcome) {
      return this.refused(
        sender,
        addressOf(target.party),
        input.text,
        outcome.refusal,
        untrusted,
        target.party,
      );
    }
    record(outcome.status, formatted);
    if (untrusted) this.delivery.suspend(target.party.id);
    return { id, status: outcome.status, reason: null };
  }

  /** The reason a message cannot go, or null. A loop pauses the pair. */
  private check(sender: Party, target: Target, text: string): string | null {
    const to = addressOf(target.party);
    const from = addressOf(sender);
    const size = sizeError(text);
    if (size) return size;
    const allowed = access(sender, target.party, this.policy);
    if (!allowed.ok) return allowed.reason;
    const key = pairKey(from, to);
    if (this.isPaused(key)) {
      return "the pair is paused by a message loop; release it in Settings";
    }
    const limit = limits(from, to, this.store.history(), this.ms(), this.policy);
    if (!limit.ok) {
      if (limit.kind === "loop") this.pause(key, from, to);
      return limit.reason;
    }
    if (!target.receives) return target.reason ?? "the session does not receive messages";
    return null;
  }

  private pause(key: string, from: string, to: string): void {
    const at = this.iso(this.ms());
    this.store.pause(key, at);
    this.emit({
      type: "messaging.alert",
      kind: "loop",
      from,
      to,
      message: `the pair ${from} and ${to} was paused: more messages than the limit going back and forth`,
      at,
    });
  }

  private isPaused(key: string): boolean {
    return this.store.isPaused(key);
  }

  pausedPairs(): string[] {
    return this.store.pausedPairs();
  }

  // --- across hosts ---

  /** A message from another host, handed over by the app; idempotent by id. */
  relay(message: RelayMessage): SendResult {
    const existing = this.store.row(message.id);
    if (existing) return relayAnswer(existing);
    const from: Party = { ...message.from };
    const refuse = (reason: string, to?: Party): SendResult => {
      this.insert({
        id: message.id,
        sender: from,
        to: to ?? blankParty(message.toSession, message.toHost),
        text: message.text,
        status: "refused",
        reason,
        teamId: null,
        kind: message.kind,
        untrusted: message.untrusted,
        formatted: null,
        createdAt: message.createdAt,
      });
      return { id: message.id, status: "refused", reason };
    };
    if (message.kind !== "session") return refuse("only session messages cross hosts");
    if (message.toHost !== this.opts.host) {
      return refuse(`the message is for another host (${message.toHost}), not this one`);
    }
    const info = this.opts.endpoints.list().find((e) => e.id === message.toSession);
    if (!info) return refuse(`session ${message.toHost}/${message.toSession} not found`);
    const to = this.dir.partyOf(info);
    const target: Target = {
      party: to,
      receives: info.controllable,
      reason: info.reason,
      local: info,
    };
    const verdict = this.check(from, target, message.text);
    if (verdict) return refuse(verdict, to);
    const formatted = formatSessionMessage(from, message.text, message.untrusted);
    const outcome = this.delivery.handOver(info, message.id, formatted);
    if ("refusal" in outcome) return refuse(outcome.refusal, to);
    this.insert({
      id: message.id,
      sender: from,
      to,
      text: message.text,
      status: outcome.status,
      reason: null,
      teamId: sharedTeam(from, to),
      kind: message.kind,
      untrusted: message.untrusted,
      formatted,
      createdAt: message.createdAt,
    });
    if (message.untrusted) this.delivery.suspend(to.id);
    return { id: message.id, status: outcome.status, reason: null };
  }

  /** The app tells how a relayed message ended at the recipient's daemon (may come twice). */
  relayed(
    id: string,
    result: { status: "delivered" | "queued" | "refused"; reason?: string | null },
  ): void {
    if (!this.store.row(id)) return;
    this.update(id, {
      status: result.status,
      reason: result.reason ?? null,
      at: this.ms(),
      relayed: true,
    });
  }

  /** Messages waiting to cross to another host. */
  outbox(): RelayMessage[] {
    return this.store.outbox();
  }

  // --- notices from Flightdeck itself ---

  /** A Flightdeck notice to a session of this host (not counted in the limits). */
  notice(
    to: string,
    kind: "system" | "idle",
    text: string,
    teamId: string | null = null,
  ): SendResult {
    const { id: sessionId } = addressParts(to);
    const info = this.opts.endpoints.list().find((e) => e.id === sessionId);
    const id = ulid(this.ms());
    const target: Party = info ? this.dir.partyOf(info) : blankParty(sessionId, this.opts.host);
    const from = blankParty(FLIGHTDECK, this.opts.host);
    const record = (
      status: MessageInfo["status"],
      reason: string | null,
      formatted: string | null,
    ) =>
      this.insert({
        id,
        sender: from,
        to: target,
        text,
        status,
        reason,
        teamId,
        kind,
        untrusted: false,
        formatted,
      });
    if (!info) {
      const reason = `session ${to} not found`;
      record("refused", reason, null);
      return { id, status: "refused", reason };
    }
    const formatted = formatSystemMessage(kind, text);
    const outcome = this.delivery.handOver(info, id, formatted);
    if ("refusal" in outcome) {
      record("refused", outcome.refusal, null);
      return { id, status: "refused", reason: outcome.refusal };
    }
    record(outcome.status, null, formatted);
    return { id, status: outcome.status, reason: null };
  }

  // --- the policy ---

  getPolicy(): Policy {
    return this.policy;
  }

  /** Replaces the policy; `unpause` frees pairs the loop detector paused. */
  setPolicy(raw: unknown, unpause: string[] = []): { policy: Policy; paused: string[] } {
    const { policy, errors } = validatePolicy(raw);
    if (errors.length > 0) {
      throw bad(errors.join("; "), "messaging_policy_invalid", { errors: errors.join("; ") });
    }
    this.policy = policy;
    this.store.savePolicy(JSON.stringify(policy));
    for (const pair of unpause) this.store.unpause(pair);
    return { policy, paused: this.pausedPairs() };
  }

  // --- the history ---

  list(filter: {
    team?: string;
    session?: string;
    host?: string;
    status?: MessageInfo["status"];
    days?: number;
    limit?: number;
  }): MessageInfo[] {
    const since = this.ms() - (filter.days ?? 30) * DAY_MS;
    const session = filter.session ? addressParts(filter.session).id : null;
    return this.store.list({
      since,
      session,
      host: filter.host ?? null,
      status: filter.status ?? null,
      team: filter.team ?? null,
      limit: filter.limit ?? 200,
    });
  }

  /** Expires the outbox past 24 hours and drops the history past retention. */
  sweep(): void {
    const now = this.ms();
    for (const id of this.store.staleOutbox(now - OUTBOX_MS)) {
      this.update(id, {
        status: "expired",
        reason: "the app did not relay it within 24 hours: the message was not sent",
        at: now,
      });
    }
    const keep = this.policy.retentionDays * DAY_MS;
    this.store.prune(now - keep);
  }

  stop(): void {
    this.delivery.stop();
    this.listeners.clear();
  }

  // --- rows ---

  private insert(input: NewMessage): void {
    this.emit({ type: "messages.updated", message: this.store.insert(input, this.ms()) });
  }

  private update(id: string, patch: MessagePatch): void {
    this.emit({ type: "messages.updated", message: this.store.update(id, patch) });
  }

  /** A refusal is recorded too: the conversations screen filters by it. */
  private refused(
    sender: Party,
    to: string,
    text: string,
    reason: string,
    untrusted: boolean,
    target?: Party,
  ): SendResult {
    const id = ulid(this.ms());
    const { host, id: sessionId } = addressParts(to);
    this.insert({
      id,
      sender,
      to: target ?? blankParty(sessionId, host ?? this.opts.host),
      text,
      status: "refused",
      reason,
      teamId: null,
      kind: "session",
      untrusted,
      formatted: null,
    });
    return { id, status: "refused", reason };
  }
}
