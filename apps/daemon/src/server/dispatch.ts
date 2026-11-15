/** Issue #248: runs a command's handler and sends its ack. The handler's shape is in `domain/handler.ts`. */
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
