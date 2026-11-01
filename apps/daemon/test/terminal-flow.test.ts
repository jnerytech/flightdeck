import { afterEach, describe, expect, test } from "bun:test";
import { startServer } from "../src/server.ts";
import {
  FLOW_HIGH_BYTES,
  FLOW_LOW_BYTES,
  TerminalManager,
  type TerminalSink,
} from "../src/terminal/terminal-manager.ts";
import { newManager, poll, workspace } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";
import { fakePtys, fakeSink } from "./pty-helpers.ts";
import { manualTime } from "./time-helpers.ts";

const TOKEN = "terminal-flow-token-0123456789abcdef";
const KB = 1024;
const MB = 1024 * KB;
/** The frames of the manager are at most this long. */
const CHUNK = 16 * KB;
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** A manager over fake PTYs and a manual clock. */
function setup() {
  const { root, project } = workspace();
  const ptys = fakePtys();
  const time = manualTime();
  const manager = new TerminalManager({
    pty: ptys.factory,
    allowedRoots: [root],
    platform: "linux",
    env: () => ({ SHELL: "/bin/zsh", PATH: "/bin" }),
    which: (name) => (name === "bash" ? "/usr/bin/bash" : null),
    timers: time.timers,
    now: time.now,
    log: () => {},
  });
  cleanups.push(() => manager.stop());
  const { terminalId } = manager.open({ cwd: project, cols: 80, rows: 24 });
  const pty = ptys.spawned[0];
  if (!pty) throw new Error("no pty");
  return { manager, pty, time, terminalId };
}

/**
 * A client as the app is: it draws what it received at its own pace and acknowledges what it
 * drew; after a resync it attaches again and starts counting from zero.
 */
function client(manager: TerminalManager, terminalId: string, time: ReturnType<typeof manualTime>) {
  const sink = fakeSink();
  const self = {
    sink,
    sent: 0,
    undrawn: 0,
    unacked: 0,
    peak: 0,
    resyncs: 0,
    flow: false,
    tail: "",
    attach() {
      sink.frames.length = 0;
      const attached = manager.attach(terminalId, sink, true);
      self.flow = attached.flow === true;
      self.undrawn = 0;
      self.unacked = 0;
      self.tail = Buffer.from(attached.scrollback, "base64").toString().slice(-16);
    },
    /** Takes what arrived, then draws at most `draw` bytes and acknowledges them. */
    step(draw: number, ack = true) {
      for (const frame of sink.frames.splice(0)) {
        if (frame.type === "terminal.data") {
          const bytes = Buffer.from(frame.data, "base64");
          self.sent += bytes.length;
          self.undrawn += bytes.length;
          self.unacked += bytes.length;
          self.tail = (self.tail + bytes.toString()).slice(-16);
        } else if (frame.type === "terminal.resync") {
          self.resyncs++;
          self.attach();
        }
      }
      self.peak = Math.max(self.peak, self.unacked);
      const drawn = Math.min(self.undrawn, draw);
      self.undrawn -= drawn;
      if (ack && drawn > 0) {
        self.unacked -= drawn;
        manager.ack(terminalId, sink, drawn);
      }
      time.advance(16);
    },
  };
  self.attach();
  return self;
}

describe("terminal-flow: output waits for the client to have drawn it", () => {
  test("a client that opts in is told the host holds output back, and one that does not is not", () => {
    const { manager, terminalId, time } = setup();
    expect(client(manager, terminalId, time).flow).toBe(true);
    expect(manager.attach(terminalId, fakeSink()).flow).toBe(false);
  });

  test("nothing past the high watermark plus one chunk is sent until the client has drawn enough to be under the low one", () => {
    const { manager, pty, terminalId, time } = setup();
    const a = client(manager, terminalId, time);
    const piece = (n: number) => `${String(n).padStart(2, "0")}`.repeat(CHUNK / 2);
    // 40 chunks of 16 KB, 640 KB: more than the high watermark, less than what is kept per client.
    for (let n = 0; n < 40; n++) pty.emit(piece(n));
    for (let i = 0; i < 5; i++) a.step(0);
    expect(a.sent).toBeGreaterThan(FLOW_HIGH_BYTES - CHUNK);
    expect(a.sent).toBeLessThanOrEqual(FLOW_HIGH_BYTES + CHUNK);
    // Drawing a little is not enough: it is still over the low watermark, so nothing more goes.
    const held = a.sent;
    a.step(FLOW_HIGH_BYTES - FLOW_LOW_BYTES - 2 * CHUNK);
    a.step(0);
    expect(a.sent).toBe(held);
    // Under the low watermark the stream resumes, and everything arrives, in order.
    a.step(3 * CHUNK);
    for (let i = 0; i < 10; i++) a.step(CHUNK);
    expect(a.sent).toBe(40 * CHUNK);
    expect(a.peak).toBeLessThanOrEqual(FLOW_HIGH_BYTES + CHUNK);
    expect(a.tail).toBe(piece(39).slice(-16));
    expect(a.resyncs).toBe(0);
  });

  test("50 MB to a client slower than the PTY: unacknowledged bytes stay under the high watermark plus a chunk, and it is resynced instead of left behind", () => {
    const { manager, pty, terminalId, time } = setup();
    const a = client(manager, terminalId, time);
    const burst = new Uint8Array(64 * KB).fill(120);
    // 64 KB every 16 ms (4 MB/s) against a client that draws 48 KB in the same time.
    let produced = 0;
    while (produced < 50 * MB) {
      pty.emit(burst);
      produced += burst.length;
      a.step(48 * KB);
    }
    pty.emit("END");
    for (let i = 0; i < 100; i++) a.step(CHUNK);
    expect(a.peak).toBeLessThanOrEqual(FLOW_HIGH_BYTES + CHUNK);
    expect(a.resyncs).toBeGreaterThan(0);
    expect(a.tail.endsWith("END")).toBe(true);
  });

  test("50 MB to a client that keeps up flows whole, with no resync and under the watermark", () => {
    const { manager, pty, terminalId, time } = setup();
    const a = client(manager, terminalId, time);
    const burst = new Uint8Array(64 * KB).fill(120);
    let produced = 0;
    while (produced < 50 * MB) {
      pty.emit(burst);
      produced += burst.length;
      a.step(64 * KB);
    }
    for (let i = 0; i < 20; i++) a.step(64 * KB);
    expect(a.sent).toBe(produced);
    expect(a.resyncs).toBe(0);
    expect(a.peak).toBeLessThanOrEqual(FLOW_HIGH_BYTES + CHUNK);
  });

  test("a client that never acknowledges gets what fits under the watermark, then one resync, then nothing that grows", () => {
    const { manager, pty, terminalId, time } = setup();
    const a = client(manager, terminalId, time);
    a.sink.frames.length = 0;
    const burst = new Uint8Array(100 * KB).fill(120);
    for (let i = 0; i < 30; i++) {
      pty.emit(burst);
      time.advance(16);
    }
    const kinds = a.sink.frames.map((frame) => frame.type);
    expect(kinds.filter((kind) => kind === "terminal.resync")).toHaveLength(1);
    expect(kinds.at(-1)).toBe("terminal.resync");
    const bytes = a.sink.frames.reduce(
      (sum, frame) =>
        sum + (frame.type === "terminal.data" ? Buffer.from(frame.data, "base64").length : 0),
      0,
    );
    expect(bytes).toBeLessThanOrEqual(FLOW_HIGH_BYTES + CHUNK);
    const before = a.sink.frames.length;
    for (let i = 0; i < 10; i++) {
      pty.emit(burst);
      time.advance(16);
    }
    expect(a.sink.frames).toHaveLength(before);
  });

  test("a client that did not opt in keeps the old behaviour: it is sent everything without acknowledging", () => {
    const { manager, pty, terminalId, time } = setup();
    const sink = fakeSink();
    manager.attach(terminalId, sink);
    const burst = new Uint8Array(100 * KB).fill(120);
    for (let i = 0; i < 8; i++) {
      pty.emit(burst);
      time.advance(16);
    }
    const bytes = sink.frames.reduce(
      (sum, frame) =>
        sum + (frame.type === "terminal.data" ? Buffer.from(frame.data, "base64").length : 0),
      0,
    );
    expect(bytes).toBe(8 * 100 * KB);
  });

  test("an ack that is late, repeated or for something gone is harmless", () => {
    const { manager, pty, terminalId, time } = setup();
    const a = client(manager, terminalId, time);
    const other: TerminalSink = fakeSink();
    expect(() => manager.ack(terminalId, other, 10)).not.toThrow();
    expect(() => manager.ack("t-gone", a.sink, 10)).not.toThrow();
    // Acknowledging far more than was sent does not let more than the watermark through later.
    manager.ack(terminalId, a.sink, 10 * MB);
    const burst = new Uint8Array(100 * KB).fill(120);
    for (let i = 0; i < 6; i++) pty.emit(burst);
    for (let i = 0; i < 5; i++) a.step(0);
    expect(a.sent).toBeLessThanOrEqual(FLOW_HIGH_BYTES + CHUNK);
  });

  test("over the protocol: terminal.attach with flow is answered with flow, output stops at the watermark and goes on after terminal.ack", async () => {
    const { root, project } = workspace();
    const ptys = fakePtys();
    const manager = new TerminalManager({
      pty: ptys.factory,
      allowedRoots: [root],
      platform: "linux",
      env: () => ({ SHELL: "/bin/zsh" }),
      which: () => null,
    });
    cleanups.push(() => manager.stop());
    const { manager: sessions } = newManager();
    const server = startServer({
      manager: sessions,
      terminals: manager,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [root],
    });
    cleanups.push(() => server.stop());
    const ws = new FrameClient(server.url);
    cleanups.push(() => ws.close());
    await ws.request("hello", { token: TOKEN, client: "t" });
    const opened = await ws.data<{ terminalId: string }>("terminal.open", {
      cwd: project,
      cols: 80,
      rows: 24,
    });
    const terminalId = opened?.terminalId ?? "";
    expect(await ws.data("terminal.attach", { terminalId, flow: true })).toMatchObject({
      flow: true,
    });
    const received = () =>
      ws.frames
        .filter((frame) => frame.type === "terminal.data")
        .reduce((sum, frame) => sum + Buffer.from(String(frame.data), "base64").length, 0);
    const burst = new Uint8Array(100 * KB).fill(120);
    for (let i = 0; i < 8; i++) ptys.spawned[0]?.emit(burst);
    await poll(() => received() >= FLOW_HIGH_BYTES - CHUNK);
    await Bun.sleep(100);
    expect(received()).toBeLessThanOrEqual(FLOW_HIGH_BYTES + CHUNK);
    expect(received()).toBeGreaterThan(FLOW_HIGH_BYTES - CHUNK);
    const first = received();
    expect(await ws.data("terminal.ack", { terminalId, bytes: first })).toBeUndefined();
    await poll(() => received() === 8 * 100 * KB);
    expect(received()).toBe(8 * 100 * KB);
    expect((await ws.request("terminal.ack", { terminalId, bytes: 0 })).ok).toBe(false);
  });
});
