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
import { slug } from "../names/index.ts";
import { formatSessionMessage, formatSystemMessage } from "./domain/header.ts";
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

/** What the messaging layer needs of the standard names. */
export interface NameBook {
  get(sessionId: string): { display: string; alias: string; aliases: string[] } | null;
  resolve(alias: string): string | null;
}

/** The frames the app watches. */
export type MessagingFrame =
  | { type: "messages.updated"; message: MessageInfo }
  | { type: "messages.relay"; message: RelayMessage }
  | {
      type: "messaging.alert";
      kind: "loop";
      from: string;
      to: string;
      message: string;
      at: string;
    };

/** Sessions of another host, as the app last told this daemon. */
export interface PeerSession {
  id: string;
  name: string | null;
  alias?: string | null;
  aliases?: string[];
  persona: string | null;
  projectKey: string | null;
  teamId: string | null;
  state: MessagingSession["state"];
  kind: MessagingSession["kind"];
  receives: boolean;
  reason: string | null;
}

/** A session of this host as the app hands it to the other daemons: the aliases always come. */
export type ListedSession = PeerSession & { alias: string | null; aliases: string[] };

/** Where a message is going. */
interface Target {
  party: Party;
  receives: boolean;
  reason: string | null;
  local: EndpointInfo | null;
}

const DAY_MS = 24 * 3_600_000;
const OUTBOX_MS = 24 * 3_600_000;
const FLIGHTDECK = "flightdeck";

type Params = Record<string, string | number>;
const bad = (message: string, reason: string, params?: Params) =>
  new FlightdeckError("bad_request", message, reason, params);
const notFound = (message: string, reason: string, params?: Params) =>
  new FlightdeckError("not_found", message, reason, params);

/** An address that does not lead to a session: the words for the logs, and the reason for the app. */
interface Missing {
  error: string;
  reason: string;
  params: Params;
}

/** The key of a pair, the same from both sides. */
const pairKey = (a: string, b: string): string =>
  [a, b].sort((a, b) => (a < b ? -1 : Number(a > b))).join("|");

export class Messaging {
  private readonly listeners = new Set<(frame: MessagingFrame) => void>();
  private readonly peers = new Map<string, PeerSession[]>();
  /** Managed messages waiting for their turn: the text that will reach the session, by message. */
  private readonly waiting = new Map<string, { to: string; formatted: string }>();
  /** Messages held for a terminal session that is waiting for a permission. */
  private readonly held = new Map<string, Array<{ id: string; formatted: string }>>();
  private policy: Policy;
  private readonly unsubscribe: Array<() => void> = [];
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
    this.unsubscribe.push(
      opts.endpoints.onUserMessage((id, text) => this.userMessage(id, text)),
      opts.endpoints.onState((id, state) => {
        if (state !== "waiting") this.release(id);
      }),
    );
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

  /** Every session of this host, unfiltered, for the app to hand to the other daemons. */
  directory(): ListedSession[] {
    return this.opts.endpoints.list().map((info) => {
      const party = this.partyOf(info);
      return {
        id: info.id,
        name: party.name,
        ...this.aliasesOf(info.id),
        persona: party.persona,
        projectKey: party.projectKey,
        teamId: party.teamId,
        state: info.state,
        kind: info.kind,
        receives: info.controllable,
        reason: info.reason,
      };
    });
  }

  setPeers(host: string, sessions: PeerSession[]): void {
    this.peers.set(host, sessions);
  }

  // --- who is who ---

  private partyOf(info: EndpointInfo): Party {
    return {
      id: info.id,
      host: this.opts.host,
      name: this.opts.names?.get(info.id)?.display ?? info.name,
      persona: this.opts.personaOf?.(info.id) ?? info.persona,
      projectKey: info.projectKey,
      teamId: this.opts.teamOf?.(info.id) ?? null,
    };
  }

  /** The standard alias of a session of this host and every alias that points at it. */
  private aliasesOf(id: string): { alias: string | null; aliases: string[] } {
    const named = this.opts.names?.get(id);
    return { alias: named?.alias ?? null, aliases: named?.aliases ?? [] };
  }

  private peerParty(host: string, peer: PeerSession): Party {
    return {
      id: peer.id,
      host,
      name: peer.name,
      persona: peer.persona,
      projectKey: peer.projectKey,
      teamId: peer.teamId,
    };
  }

  /** Who a session identity is (throws when the daemon does not know it). */
  whoIs(as: SessionIdentity): Party {
    return this.resolve(as);
  }

  /** The session that is asking: a managed one by id, a terminal one by the launch it came from. */
  private resolve(who: SessionIdentity): Party {
    const id = who.session ?? this.opts.endpoints.byLaunch(who.launch as string);
    const info = id ? this.opts.endpoints.list().find((e) => e.id === id) : undefined;
    if (!info) {
      throw notFound(
        "the asking session does not exist on this host: I do not know who is sending",
        "messaging_asker_unknown",
      );
    }
    return this.partyOf(info);
  }

  private target(address: string): Target | Missing {
    const { host, id } = addressParts(address);
    if (host === null || host === this.opts.host) {
      const sessionId = this.opts.names?.resolve(id) ?? id;
      const list = this.opts.endpoints.list();
      const info = list.find((e) => e.id === id) ?? list.find((e) => e.id === sessionId);
      if (!info) {
        return {
          error: `session ${address} not found on this host`,
          reason: "messaging_target_not_found",
          params: { address },
        };
      }
      return {
        party: this.partyOf(info),
        receives: info.controllable,
        reason: info.reason,
        local: info,
      };
    }
    const sessions = this.peers.get(host);
    if (!sessions) {
      return {
        error: `the host ${host} is not known: the app describes the hosts`,
        reason: "messaging_host_unknown",
        params: { host },
      };
    }
    const alias = slug(id);
    const peer =
      sessions.find((s) => s.id === id) ?? sessions.find((s) => s.aliases?.includes(alias));
    if (!peer) {
      return {
        error: `session ${address} not found on host ${host}`,
        reason: "messaging_peer_not_found",
        params: { address, host },
      };
    }
    return {
      party: this.peerParty(host, peer),
      receives: peer.receives,
      reason: peer.reason,
      local: null,
    };
  }

  /** The sessions the asker may see, by the rules. */
  sessions(as: SessionIdentity): MessagingSession[] {
    const sender = this.resolve(as);
    const seen: MessagingSession[] = [];
    const consider = (
      party: Party,
      extra: Pick<MessagingSession, "state" | "kind" | "receives" | "reason" | "alias" | "aliases">,
    ) => {
      if (addressOf(party) === addressOf(sender)) return;
      if (!access(sender, party, this.policy).ok) return;
      seen.push({
        address: addressOf(party),
        id: party.id,
        host: party.host,
        name: party.name,
        persona: party.persona,
        projectKey: party.projectKey,
        teamId: party.teamId,
        ...extra,
      });
    };
    for (const info of this.opts.endpoints.list()) {
      consider(this.partyOf(info), {
        ...this.aliasesOf(info.id),
        state: info.state,
        kind: info.kind,
        receives: info.controllable,
        reason: info.reason,
      });
    }
    for (const [host, sessions] of this.peers) {
      for (const peer of sessions) {
        consider(this.peerParty(host, peer), {
          alias: peer.alias ?? null,
          aliases: peer.aliases ?? [],
          state: peer.state,
          kind: peer.kind,
          receives: peer.receives,
          reason: peer.reason,
        });
      }
    }
    return seen;
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
    const sender = this.resolve(as);
    const target = this.target(address);
    if ("error" in target) throw notFound(target.error, target.reason, target.params);
    const allowed = access(sender, target.party, this.policy);
    if (!allowed.ok) throw new FlightdeckError("invalid_state", allowed.reason, allowed.code);
    return { sender, target: target.party, info: target.local };
  }

  /** `read_session`: the summary and the last messages of a session this one may see. */
  async read(as: SessionIdentity, address: string, last = 10): Promise<ReadSessionResult> {
    const { info } = this.inspect(as, address);
    if (!info) {
      throw new FlightdeckError(
        "invalid_state",
        "the session is on another host: read_session only reads sessions of this host",
        "messaging_read_other_host",
      );
    }
    const read = await this.opts.endpoints.read(info.id, last);
    if (!read) {
      throw notFound(`session ${address} not found`, "messaging_target_not_found", { address });
    }
    return read;
  }

  // --- sending ---

  send(input: { as: SessionIdentity; to: string; text: string }): SendResult {
    const sender = this.resolve(input.as);
    const untrusted = this.opts.endpoints.untrusted(sender.id);
    const target = this.target(input.to);
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
    const teamId =
      sender.teamId !== null && sender.teamId === target.party.teamId ? sender.teamId : null;
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
    const outcome = this.handOver(target.local, id, formatted);
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
    if (untrusted) this.suspend(target.party.id);
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

  /**
   * Gives the text to a session of this host. A terminal waiting for a permission is not written to
   * (a message must never end up answering the prompt): it is held until it leaves that state.
   */
  private handOver(
    info: EndpointInfo,
    id: string,
    formatted: string,
  ): { status: "delivered" | "queued" } | { refusal: string } {
    const current = this.opts.endpoints.list().find((e) => e.id === info.id) ?? info;
    if (current.kind === "terminal" && current.state === "waiting") {
      const list = this.held.get(info.id) ?? [];
      list.push({ id, formatted });
      this.held.set(info.id, list);
      return { status: "queued" };
    }
    try {
      const status = this.opts.endpoints.send(info.id, formatted);
      if (status === "queued") this.waiting.set(id, { to: info.id, formatted });
      return { status };
    } catch (error) {
      if (error instanceof FlightdeckError) return { refusal: error.message };
      throw error;
    }
  }

  /** A terminal left `waiting`: what was held for it goes now. */
  private release(sessionId: string): void {
    const list = this.held.get(sessionId);
    if (!list) return;
    this.held.delete(sessionId);
    for (const item of list) {
      try {
        const status = this.opts.endpoints.send(sessionId, item.formatted);
        if (status === "queued") {
          this.waiting.set(item.id, { to: sessionId, formatted: item.formatted });
        } else {
          this.update(item.id, { status: "delivered", at: this.ms() });
        }
      } catch (error) {
        this.update(item.id, {
          status: "refused",
          reason: (error as Error).message,
          at: this.ms(),
        });
      }
    }
  }

  /** A user message reached a managed session: the queued message with that text was delivered. */
  private userMessage(sessionId: string, text: string): void {
    for (const [id, pending] of this.waiting) {
      if (pending.to === sessionId && pending.formatted === text) {
        this.waiting.delete(id);
        this.update(id, { status: "delivered", at: this.ms() });
        return;
      }
    }
  }

  private suspend(sessionId: string): void {
    this.opts.endpoints.suspend(
      sessionId,
      "message from a session that received third-party content",
    );
  }

  // --- across hosts ---

  /** A message from another host, handed over by the app; idempotent by id. */
  relay(message: RelayMessage): SendResult {
    const existing = this.store.row(message.id);
    if (existing) {
      return {
        id: existing.id,
        status:
          existing.status === "delivered" || existing.status === "queued"
            ? existing.status
            : "refused",
        reason: existing.reason,
      };
    }
    const from: Party = { ...message.from };
    const refuse = (reason: string, to?: Party): SendResult => {
      this.insert({
        id: message.id,
        sender: from,
        to: to ?? {
          id: message.toSession,
          host: message.toHost,
          name: null,
          persona: null,
          projectKey: null,
          teamId: null,
        },
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
    const to = this.partyOf(info);
    const target: Target = {
      party: to,
      receives: info.controllable,
      reason: info.reason,
      local: info,
    };
    const verdict = this.check(from, target, message.text);
    if (verdict) return refuse(verdict, to);
    const formatted = formatSessionMessage(from, message.text, message.untrusted);
    const outcome = this.handOver(info, message.id, formatted);
    if ("refusal" in outcome) return refuse(outcome.refusal, to);
    this.insert({
      id: message.id,
      sender: from,
      to,
      text: message.text,
      status: outcome.status,
      reason: null,
      teamId: from.teamId !== null && from.teamId === to.teamId ? from.teamId : null,
      kind: message.kind,
      untrusted: message.untrusted,
      formatted,
      createdAt: message.createdAt,
    });
    if (message.untrusted) this.suspend(to.id);
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
    const target: Party = info
      ? this.partyOf(info)
      : {
          id: sessionId,
          host: this.opts.host,
          name: null,
          persona: null,
          projectKey: null,
          teamId: null,
        };
    const from: Party = {
      id: FLIGHTDECK,
      host: this.opts.host,
      name: null,
      persona: null,
      projectKey: null,
      teamId: null,
    };
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
    const outcome = this.handOver(info, id, formatted);
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
    for (const off of this.unsubscribe.splice(0)) off();
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
      to: target ?? {
        id: sessionId,
        host: host ?? this.opts.host,
        name: null,
        persona: null,
        projectKey: null,
        teamId: null,
      },
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
