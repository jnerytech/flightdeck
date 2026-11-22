import { describe, expect, test } from "bun:test";
import type { TerminalAttachResult } from "@flightdeck/protocol";
import {
  type TerminalFailure,
  TerminalSession,
} from "../../src/features/terminal/terminal-session.ts";

const attached: TerminalAttachResult = {
  terminalId: "t1",
  scrollback: "",
  cols: 80,
  rows: 24,
  exitCode: null,
};

/** A session over a host whose attach and write the test can refuse. */
function setup() {
  const failures: Array<[TerminalFailure, unknown]> = [];
  const writes: string[] = [];
  const host = {
    refuseAttach: null as Error | null,
    refuseWrite: null as Error | null,
  };
  const session = new TerminalSession({
    terminalId: "t1",
    host: {
      attach: async () => {
        if (host.refuseAttach) throw host.refuseAttach;
        return attached;
      },
      ack: async () => null,
      write: async (_id, data) => {
        if (host.refuseWrite) throw host.refuseWrite;
        writes.push(data);
        return null;
      },
      resize: async () => null,
      close: async () => null,
    },
    screen: { write: () => {}, reset: () => {} },
    onState: () => {},
    onFailure: (kind, error) => void failures.push([kind, error]),
  });
  return { session, failures, writes, host };
}

/** Lets the write's promise callbacks run, however many hops they take. */
const afterWrite = () => new Promise((resolve) => setTimeout(resolve, 0));

// Issue #3950: an attach or a write the host refuses is told to the screen with its reason, and it is
// told again, as `null`, once the next one is accepted, so the screen can show and clear it.
describe("terminal-ui: what the host refuses an attach or a write with", () => {
  test("an attach the host refuses reports its reason, and a later one that works clears it", async () => {
    const { session, failures, host } = setup();
    host.refuseAttach = new Error("gone");
    await session.start();
    expect(failures).toEqual([["attach", host.refuseAttach]]);
    host.refuseAttach = null;
    await session.reopen();
    expect(failures.at(-1)).toEqual(["attach", null]);
  });

  test("a write the host refuses reports its reason, and the next accepted write clears it", async () => {
    const { session, failures, writes, host } = setup();
    await session.start();
    host.refuseWrite = new Error("No room left");
    session.input("a");
    await afterWrite();
    expect(failures.filter(([kind]) => kind === "write")).toEqual([["write", host.refuseWrite]]);
    host.refuseWrite = null;
    session.input("b");
    await afterWrite();
    expect(writes).toEqual(["b"]);
    expect(failures.at(-1)).toEqual(["write", null]);
  });

  test("keys typed while the terminal is not live are not sent and report no failure", async () => {
    const { session, failures, writes } = setup();
    session.input("a");
    await afterWrite();
    expect(writes).toEqual([]);
    expect(failures).toEqual([]);
  });
});
