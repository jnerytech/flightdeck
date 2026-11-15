/**
 * Issue #248: a command's handler and how its reply becomes the ack. A handler gets the command's
 * payload and the call (the socket, a bound `send`, the server's context); what it returns is the
 * ack's data. `afterAck` is for the streams that answer, then replay, then go live (`*.subscribe`,
 * `*.watch`): the dispatcher sends the ack and runs the rest in the same synchronous step, so no
 * frame can fall between them.
 */
import type { Command, CommandPayload, CommandType } from "@flightdeck/protocol";
import { AfterAck, type Call, type Handler } from "./domain/handler.ts";

/** Runs a command's handler and sends its ack; a throw goes up to the transport's error mapping. */
export async function runHandler<T extends CommandType>(
  handler: Handler<T>,
  command: Extract<Command, { type: T }>,
  call: Call,
): Promise<void> {
  const reply = await handler(command.payload as CommandPayload<T>, call);
  const data = reply instanceof AfterAck ? reply.data : reply;
  call.send({ type: "ack", id: command.id, ok: true, ...(data !== undefined ? { data } : {}) });
  if (reply instanceof AfterAck) reply.rest();
}
