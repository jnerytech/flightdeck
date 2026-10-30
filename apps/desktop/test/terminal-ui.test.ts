import { describe, expect, test } from "bun:test";
import type { TerminalAttachResult } from "@flightdeck/protocol";
import {
  RESIZE_DEBOUNCE_MS,
  TerminalSession,
  type TerminalState,
} from "../src/lib/terminal-session.ts";

const b64 = (text: string) => Buffer.from(text).toString("base64");
const text = (bytes: Uint8Array) => Buffer.from(bytes).toString();

function setup(attach: Partial<TerminalAttachResult> = {}) {
  const calls: unknown[][] = [];
  const drawn: string[] = [];
  const states: [TerminalState, number | null][] = [];
  const timers: { run: () => void; ms: number; cancelled: boolean }[] = [];
  const attachResult: TerminalAttachResult = {
    terminalId: "t1",
    scrollback: b64("hello\r\n"),
    cols: 80,
    rows: 24,
    exitCode: null,
    ...attach,
  };
  const session = new TerminalSession({
    terminalId: "t1",
    host: {
      attach: async (id) => {
        calls.push(["attach", id]);
        return attachResult;
      },
      write: async (id, data) => void calls.push(["write", id, data]),
      resize: async (id, cols, rows) => void calls.push(["resize", id, cols, rows]),
      close: async (id, kill) => void calls.push(["close", id, kill]),
    },
    screen: {
      write: (bytes) => void drawn.push(text(bytes)),
      reset: () => void drawn.push("<reset>"),
    },
    onState: (state, exitCode) => void states.push([state, exitCode]),
    schedule: (run, ms) => {
      const timer = { run, ms, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
  });
  return { session, calls, drawn, states, timers };
}

describe("terminal-ui: the session of one terminal", () => {
  test("start attaches, draws the scrollback and goes live", async () => {
    const { session, calls, drawn, states } = setup();
    await session.start();
    expect(calls).toEqual([["attach", "t1"]]);
    expect(drawn).toEqual(["<reset>", "hello\r\n"]);
    expect(states).toEqual([
      ["attaching", null],
      ["live", null],
    ]);
  });

  test("a terminal that already ended is shown as ended with its exit code", async () => {
    const { session, states } = setup({ exitCode: 3 });
    await session.start();
    expect(states.at(-1)).toEqual(["ended", 3]);
    expect(session.state).toBe("ended");
  });

  test("data frames are decoded and drawn; exited ends the terminal", async () => {
    const { session, drawn, states } = setup();
    await session.start();
    session.data(b64("ação\r\n"));
    expect(drawn.at(-1)).toBe("ação\r\n");
    session.exited(0);
    expect(states.at(-1)).toEqual(["ended", 0]);
  });

  test("keys are written to the terminal, except once it has ended", async () => {
    const { session, calls } = setup();
    await session.start();
    session.input("ls\r");
    session.exited(1);
    session.input("x");
    expect(calls.filter((call) => call[0] === "write")).toEqual([["write", "t1", "ls\r"]]);
  });

  test("resizes are debounced: only the last size is sent, 100 ms after the last change", async () => {
    const { session, calls, timers } = setup();
    await session.start();
    session.resize(100, 30);
    session.resize(120, 40);
    expect(RESIZE_DEBOUNCE_MS).toBe(100);
    expect(timers.map((timer) => [timer.ms, timer.cancelled])).toEqual([
      [100, true],
      [100, false],
    ]);
    expect(calls.some((call) => call[0] === "resize")).toBe(false);
    timers[1]?.run();
    expect(calls.filter((call) => call[0] === "resize")).toEqual([["resize", "t1", 120, 40]]);
  });

  test("a lost connection leaves the terminal detached; reopen attaches again from scratch", async () => {
    const { session, calls, drawn, states } = setup();
    await session.start();
    session.disconnected();
    expect(states.at(-1)).toEqual(["detached", null]);
    await session.reopen();
    expect(calls.filter((call) => call[0] === "attach")).toHaveLength(2);
    expect(drawn.filter((entry) => entry === "<reset>")).toHaveLength(2);
    expect(states.at(-1)).toEqual(["live", null]);
  });

  test("an attach the host refuses leaves the terminal detached", async () => {
    const { session, states } = setup();
    session.opts.host.attach = async () => {
      throw new Error("gone");
    };
    await session.start();
    expect(states.at(-1)).toEqual(["detached", null]);
  });

  test("close sends whether the process is killed (end) or kept (detach)", async () => {
    const { session, calls } = setup();
    await session.start();
    await session.close(false);
    await session.close(true);
    expect(calls.filter((call) => call[0] === "close")).toEqual([
      ["close", "t1", false],
      ["close", "t1", true],
    ]);
  });

  test("dispose cancels a pending resize", async () => {
    const { session, timers } = setup();
    await session.start();
    session.resize(90, 20);
    session.dispose();
    expect(timers[0]?.cancelled).toBe(true);
  });

  test("a host that refuses a write, a resize or a close does not break the session", async () => {
    const { session, timers } = setup();
    const refuse = async () => {
      throw new Error("offline");
    };
    session.opts.host.write = refuse;
    session.opts.host.resize = refuse;
    session.opts.host.close = refuse;
    await session.start();
    session.input("a");
    session.resize(90, 20);
    timers[0]?.run();
    await session.close(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(session.state).toBe("live");
  });

  test("it decodes the output without Node's Buffer, as in the browser", async () => {
    const scrollback = b64("olá\r\n");
    const saved = globalThis.Buffer;
    const drawn: string[] = [];
    let last: TerminalState | null = null;
    const session = new TerminalSession({
      terminalId: "t1",
      host: {
        attach: async () => ({ terminalId: "t1", scrollback, cols: 80, rows: 24, exitCode: null }),
        write: async () => null,
        resize: async () => null,
        close: async () => null,
      },
      screen: {
        write: (bytes) => void drawn.push(new TextDecoder().decode(bytes)),
        reset: () => {},
      },
      onState: (state) => {
        last = state;
      },
    });
    Reflect.deleteProperty(globalThis, "Buffer");
    try {
      await session.start();
    } finally {
      globalThis.Buffer = saved;
    }
    expect(last as TerminalState | null).toBe("live");
    expect(drawn).toEqual(["olá\r\n"]);
  });

  test("without a schedule of its own, the resize waits on a real 100 ms timer", async () => {
    const sizes: number[][] = [];
    const session = new TerminalSession({
      terminalId: "t1",
      host: {
        attach: async () => ({
          terminalId: "t1",
          scrollback: "",
          cols: 80,
          rows: 24,
          exitCode: null,
        }),
        write: async () => null,
        resize: async (_id, cols, rows) => void sizes.push([cols, rows]),
        close: async () => null,
      },
      screen: { write: () => {}, reset: () => {} },
      onState: () => {},
    });
    session.resize(90, 30);
    expect(sizes).toEqual([]);
    await Bun.sleep(150);
    expect(sizes).toEqual([[90, 30]]);
  });
});
