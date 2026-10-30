import type { MessageInfo, RelayMessage } from "@flightdeck/protocol";

/**
 * Phase 21: what the app does between daemons of different hosts. A daemon cannot reach another
 * host, so it hands the app the messages for one (`messages.relay`) and the app carries them,
 * tells the origin how they ended, and keeps each daemon told of the others' sessions.
 */
export interface RelayHost {
  id: string;
  /** The daemon's own host name: the one a message's address carries. */
  hostName: string;
  /** Only an online host finished an authenticated `hello`; nothing goes to any other. */
  online: boolean;
}

export interface RelayDeps {
  hosts(): RelayHost[];
  call(hostId: string, type: string, payload: unknown): Promise<unknown>;
}

/** The online host whose daemon is called `hostName`; none for an offline or unknown one. */
const onlineHost = (deps: RelayDeps, hostName: string) =>
  deps.hosts().find((h) => h.online && h.hostName === hostName);

/** A `messages.relay` frame from `fromId`: carried to the host it names, the result told back. */
export async function relayMessage(
  deps: RelayDeps,
  fromId: string,
  message: RelayMessage,
): Promise<void> {
  const target = onlineHost(deps, message.toHost);
  // Not reachable now: it waits in the origin's queue, which replays it when the app reconnects.
  if (!target) return;
  let result: { status: string; reason?: string | null };
  try {
    // The recipient's daemon checks its own rules again: what it refuses comes back with why.
    result = (await deps.call(target.id, "messages.relay", { message })) as typeof result;
  } catch {
    return;
  }
  await deps.call(fromId, "messages.relayed", {
    id: message.id,
    status: result.status,
    reason: result.reason ?? null,
  });
}

/** A message that came from another host changed at its recipient: the origin is told. */
export async function relayUpdate(
  deps: RelayDeps,
  atId: string,
  message: MessageInfo,
): Promise<void> {
  const here = deps.hosts().find((h) => h.id === atId);
  if (!here || message.fromHost === here.hostName) return;
  if (message.status !== "delivered" && message.status !== "refused") return;
  const origin = onlineHost(deps, message.fromHost);
  if (!origin) return;
  await deps.call(origin.id, "messages.relayed", {
    id: message.id,
    status: message.status,
    reason: message.reason,
  });
}

/** Each daemon is told the sessions of the other online daemons. */
export async function syncPeers(deps: RelayDeps): Promise<void> {
  const online = deps.hosts().filter((h) => h.online);
  for (const host of online) {
    const directory = (await deps.call(host.id, "messages.directory", {})) as {
      host: string;
      sessions: unknown[];
    };
    for (const other of online) {
      if (other.id === host.id) continue;
      await deps.call(other.id, "messages.peers", {
        host: directory.host,
        sessions: directory.sessions,
      });
    }
  }
}
