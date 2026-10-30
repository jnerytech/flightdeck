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

/** A `messages.relay` frame from `fromId`: carried to the host it names, the result told back. */
export async function relayMessage(
  _deps: RelayDeps,
  _fromId: string,
  _message: RelayMessage,
): Promise<void> {}

/** A message that came from another host changed at its recipient: the origin is told. */
export async function relayUpdate(
  _deps: RelayDeps,
  _atId: string,
  _message: MessageInfo,
): Promise<void> {}

/** Each daemon is told the sessions of the other online daemons. */
export async function syncPeers(_deps: RelayDeps): Promise<void> {}
