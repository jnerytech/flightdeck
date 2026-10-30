import { afterEach, describe, expect, test } from "bun:test";
import type { TerminalData, TerminalExited, TerminalResync } from "@flightdeck/protocol";
import { HostConnection } from "../src/lib/host-connection.ts";
import { daemon as makeDaemon, TOKEN, waitFor } from "./fixtures.ts";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

describe("terminal-ui: the host connection and the terminal frames", () => {
  test("terminal.data and terminal.exited reach onTerminal after an attach", async () => {
    const d = makeDaemon(cleanups, { terminals: true });
    const frames: Array<TerminalData | TerminalExited | TerminalResync> = [];
    const conn = new HostConnection({
      url: d.listen().url,
      token: TOKEN,
      clientName: "test",
      lastSeqFor: () => 0,
      onEvent: () => {},
      onStatus: () => {},
      onSubscribed: () => {},
      onTerminal: (frame) => frames.push(frame),
    });
    cleanups.push(() => conn.dispose());
    conn.connect();
    await waitFor(() => conn.status === "online", "online");
    const { terminalId } = await conn.request("terminal.open", {
      cwd: d.project,
      cols: 80,
      rows: 24,
    });
    await conn.request("terminal.attach", { terminalId });
    await conn.request("terminal.write", { terminalId, data: "oi\r" });
    const echoed = () =>
      frames.some((f) => f.type === "terminal.data" && atob(f.data).includes("oi"));
    await waitFor(echoed, "terminal.data").catch(() => null);
    expect(echoed()).toBe(true);
    d.ptys.spawned[0]?.exit(0);
    await waitFor(() => frames.some((f) => f.type === "terminal.exited")).catch(() => null);
    expect(frames.find((f) => f.type === "terminal.exited")).toEqual({
      type: "terminal.exited",
      terminalId,
      exitCode: 0,
    });
  });
});
