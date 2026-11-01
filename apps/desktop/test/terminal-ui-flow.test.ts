import { describe, expect, test } from "bun:test";
import type { TerminalAttachResult } from "@flightdeck/protocol";
import { ACK_BYTES, TerminalSession } from "../src/lib/terminal-session.ts";

const KB = 1024;
const b64 = (bytes: number) => Buffer.from(new Uint8Array(bytes).fill(120)).toString("base64");

/** A session whose screen draws only when the test says so, over a host that records its acks. */
function setup(attach: Partial<TerminalAttachResult> = {}, failAck = false) {
  const acks: number[] = [];
  const pending: Array<() => void> = [];
  const session = new TerminalSession({
    terminalId: "t1",
    host: {
      attach: async () => ({
        terminalId: "t1",
        scrollback: b64(10),
        cols: 80,
        rows: 24,
        exitCode: null,
        flow: true,
        ...attach,
      }),
      ack: async (_id, bytes) => {
        acks.push(bytes);
        if (failAck) throw new Error("refused");
      },
      write: async () => null,
      resize: async () => null,
      close: async () => null,
    },
    screen: {
      write: (_bytes, done) => {
        if (done) pending.push(done);
      },
      reset: () => {},
    },
    onState: () => {},
  });
  const draw = () => {
    for (const done of pending.splice(0)) done();
  };
  return { session, acks, draw, pending };
}

describe("terminal-flow: the app acknowledges what xterm has drawn", () => {
  test("nothing is acknowledged before xterm has drawn it, and then in one step of at least 64 KB", async () => {
    const { session, acks, draw } = setup();
    await session.start();
    for (let i = 0; i < 3; i++) session.data(b64(30 * KB));
    expect(acks).toEqual([]);
    draw();
    expect(acks).toEqual([90 * KB]);
  });

  test("less than a step is held until more has been drawn, and every byte is counted once", async () => {
    const { session, acks, draw } = setup();
    await session.start();
    session.data(b64(ACK_BYTES - 1));
    draw();
    expect(acks).toEqual([]);
    session.data(b64(1));
    draw();
    expect(acks).toEqual([ACK_BYTES]);
    session.data(b64(ACK_BYTES));
    draw();
    expect(acks).toEqual([ACK_BYTES, ACK_BYTES]);
  });

  test("a host that does not hold output back is never sent an ack", async () => {
    const { session, acks, draw } = setup({ flow: undefined });
    await session.start();
    session.data(b64(200 * KB));
    draw();
    expect(acks).toEqual([]);
  });

  test("what was being drawn when the terminal attached again is not acknowledged to the new attach", async () => {
    const { session, acks, draw } = setup();
    await session.start();
    session.data(b64(100 * KB));
    await session.reopen();
    draw();
    expect(acks).toEqual([]);
    session.data(b64(ACK_BYTES));
    draw();
    expect(acks).toEqual([ACK_BYTES]);
  });

  test("a refused ack is not an error for the session", async () => {
    const { session, acks, draw } = setup({}, true);
    await session.start();
    session.data(b64(ACK_BYTES));
    expect(() => draw()).not.toThrow();
    await Bun.sleep(5);
    expect(acks).toEqual([ACK_BYTES]);
  });
});
