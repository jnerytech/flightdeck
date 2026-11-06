/**
 * Issue #248: a command's handler and how its reply becomes the ack. A handler gets the command's
 * payload and the call (the socket, a bound `send`, the server's context); what it returns is the
 * ack's data. `afterAck` is for the streams that answer, then replay, then go live (`*.subscribe`,
 * `*.watch`): the dispatcher sends the ack and runs the rest in the same synchronous step, so no
 * frame can fall between them.
 */
import type { Command, CommandPayload, CommandResults, CommandType } from "@flightdeck/protocol";
import type { ServerContext } from "./context.ts";
import type { Outgoing, Socket } from "./transport.ts";

export interface Call {
  ws: Socket;
  send(frame: Outgoing): void;
  server: ServerContext;
}

/**
 * A class, not a plain object: a handler's reply is awaited, and an object with a `then` method
 * would be taken for a promise.
 */
export class AfterAck<T extends CommandType> {
  constructor(
    readonly data: CommandResults[T] | undefined,
    readonly rest: () => void,
  ) {}
}

export type Reply<T extends CommandType> = CommandResults[T] | undefined | AfterAck<T>;

export type Handler<T extends CommandType> = (
  payload: CommandPayload<T>,
  call: Call,
) => Reply<T> | Promise<Reply<T>>;

export type Handlers = { [T in CommandType]: Handler<T> };

/** The ack goes out with `data`, then `rest` runs, with nothing in between. */
export function afterAck<T extends CommandType>(
  data: CommandResults[T] | undefined,
  rest: () => void,
): AfterAck<T> {
  return new AfterAck(data, rest);
}

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
