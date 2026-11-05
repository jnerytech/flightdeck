import { describe, expect, test } from "bun:test";
import type { Command } from "@flightdeck/protocol";
import { FlightdeckError } from "../src/errors.ts";
import { type ServerContext, serverContext } from "../src/server/context.ts";
import { afterAck, type Call, type Handler, runHandler } from "../src/server/dispatch.ts";
import type { Outgoing, Socket } from "../src/server/transport.ts";
import type { ServerOptions } from "../src/server.ts";

type Interrupt = Extract<Command, { type: "session.interrupt" }>;
type List = Extract<Command, { type: "session.list" }>;

const interrupt: Interrupt = { id: "7", type: "session.interrupt", payload: { sessionId: "s1" } };
const list: List = { id: "8", type: "session.list", payload: {} };

/** A call whose frames are kept in order. */
function call(): { call: Call; sent: unknown[] } {
  const sent: unknown[] = [];
  return {
    sent,
    call: {
      ws: {} as Socket,
      send: (frame: Outgoing) => sent.push(frame),
      server: {} as ServerContext,
    },
  };
}

describe("server-dispatch", () => {
  test("a handler's reply is the ack's data; no reply is a plain ack", async () => {
    const withData = call();
    const listing: Handler<"session.list"> = () => ({ sessions: [] });
    await runHandler(listing, list, withData.call);
    const plain = call();
    let asked: unknown = null;
    const interrupting: Handler<"session.interrupt"> = async (payload) => {
      asked = payload;
    };
    await runHandler(interrupting, interrupt, plain.call);
    expect([withData.sent, plain.sent, asked]).toEqual([
      [{ type: "ack", id: "8", ok: true, data: { sessions: [] } }],
      [{ type: "ack", id: "7", ok: true }],
      { sessionId: "s1" },
    ]);
  });

  test("afterAck sends the ack, then runs the rest in the same step", async () => {
    const { call: c, sent } = call();
    const seenFromThen: number[] = [];
    const subscribe: Handler<"session.list"> = (_payload, { send }) =>
      afterAck({ sessions: [] }, () => {
        seenFromThen.push(sent.length);
        send({ type: "ping", id: "replayed" } as Outgoing);
      });
    await runHandler(subscribe, list, c);
    expect([sent, seenFromThen]).toEqual([
      [
        { type: "ack", id: "8", ok: true, data: { sessions: [] } },
        { type: "ping", id: "replayed" },
      ],
      [1],
    ]);
  });

  test("a handler's refusal goes up to the transport, with no ack sent", async () => {
    const { call: c, sent } = call();
    const refusing: Handler<"session.interrupt"> = () => {
      throw new FlightdeckError("not_found", "no session", "session_not_found");
    };
    const reason = await runHandler(refusing, interrupt, c).then(
      () => null,
      (error: unknown) => (error instanceof FlightdeckError ? error.reason : String(error)),
    );
    expect([reason, sent]).toEqual(["session_not_found", []]);
  });

  test("the context's gates refuse an option the host does not run", () => {
    const context = serverContext({ manager: {} } as unknown as ServerOptions);
    let feature: unknown = null;
    try {
      context.need("vault");
    } catch (error) {
      feature = error instanceof FlightdeckError ? error.params?.feature : String(error);
    }
    expect(feature).toBe("vault");
  });
});
