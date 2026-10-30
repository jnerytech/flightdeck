/**
 * Phase 21: what the messaging tools answer, shared by the MCP server and by `flightdeckd message`
 * (the way the `flightdeck-actions` mod reaches them). Each takes who is asking and speaks the
 * protocol of the local daemon.
 */
import type {
  CommandPayload,
  CommandResults,
  CommandType,
  SessionIdentity,
} from "@flightdeck/protocol";

/** Anything that sends a protocol command and waits for its answer. */
export interface Caller {
  call<T extends CommandType>(type: T, payload: CommandPayload<T>): Promise<CommandResults[T]>;
}

export const listSessions = (daemon: Caller, as: SessionIdentity) =>
  daemon.call("messages.sessions", { as });

/** `entregue`, `na fila` or `recusada` with the reason. */
export async function sendToSession(daemon: Caller, as: SessionIdentity, to: string, text: string) {
  const sent = await daemon.call("messages.send", { as, to, text });
  const resultado =
    sent.status === "delivered" ? "entregue" : sent.status === "queued" ? "na fila" : "recusada";
  return { resultado, ...(sent.reason ? { motivo: sent.reason } : {}), id: sent.id };
}

export async function notifyWhenIdle(daemon: Caller, as: SessionIdentity, session: string) {
  const subscribed = await daemon.call("idle.subscribe", { as, session });
  return { avisado: subscribed.fired };
}

export const readSession = (daemon: Caller, as: SessionIdentity, session: string, last?: number) =>
  daemon.call("messages.read", { as, session, ...(last ? { last } : {}) });

export const teamStatus = (daemon: Caller, as: SessionIdentity, team: string) =>
  daemon.call("teams.status", { team, as });
