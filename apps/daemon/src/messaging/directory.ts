import type { MessagingSession, ReadSessionResult, SessionIdentity } from "@flightdeck/protocol";
import { FlightdeckError } from "../kernel/index.ts";
import { slug } from "../names/index.ts";
import { type ListingExtra, listedSession } from "./domain/listing.ts";
import type { ListedSession, Missing, Params, PeerSession } from "./domain/peers.ts";
import { access, addressOf, addressParts, type Party, type Policy } from "./domain/policy.ts";
import type { EndpointInfo, Endpoints } from "./endpoints.ts";

/** What the messaging layer needs of the standard names. */
export interface NameBook {
  get(sessionId: string): { display: string; alias: string; aliases: string[] } | null;
  resolve(alias: string): string | null;
}

/** Where a message is going. */
export interface Target {
  party: Party;
  receives: boolean;
  reason: string | null;
  local: EndpointInfo | null;
}

export interface DirectoryOptions {
  /** This host's name, the first half of every address. */
  host: string;
  endpoints: Endpoints;
  /** The policy in force, read at each question: it changes while the daemon runs. */
  policy: () => Policy;
  /** The team a session belongs to, if any. */
  teamOf?: (sessionId: string) => string | null;
  /** The persona badge of a session (phase 20); the endpoint's own when absent. */
  personaOf?: (sessionId: string) => string | null;
  /** The standard names of the sessions: their aliases address them. */
  names?: NameBook;
}

const notFound = (message: string, reason: string, params?: Params) =>
  new FlightdeckError("not_found", message, reason, params);

/**
 * Who is who: the sessions of this host and of the other hosts the app describes, how an address
 * finds one, and what a session may see of the others under the policy.
 */
export class Directory {
  private readonly peers = new Map<string, PeerSession[]>();

  constructor(private readonly opts: DirectoryOptions) {}

  /** Every session of this host, unfiltered, for the app to hand to the other daemons. */
  listing(): ListedSession[] {
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

  partyOf(info: EndpointInfo): Party {
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

  /** The session that is asking: a managed one by id, a terminal one by the launch it came from. */
  resolve(who: SessionIdentity): Party {
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

  target(address: string): Target | Missing {
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
    const consider = (party: Party, extra: ListingExtra) => {
      if (addressOf(party) === addressOf(sender)) return;
      if (!access(sender, party, this.opts.policy()).ok) return;
      seen.push(listedSession(party, extra));
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
    const allowed = access(sender, target.party, this.opts.policy());
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
}
