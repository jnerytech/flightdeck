import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ProcessLedger,
  type ProcIdentity,
  type ProcSource,
  parseStat,
  procSource,
} from "../src/runtime/process-ledger.ts";
import { tempDir } from "./helpers.ts";

/** A pretend /proc: processes by pid, each with its group and start. */
class FakeProc implements ProcSource {
  readonly table = new Map<number, ProcIdentity>();
  identity(pid: number) {
    return this.table.get(pid) ?? null;
  }
  members(pgid: number) {
    return [...this.table]
      .filter(([, p]) => p.pgrp === pgid)
      .map(([pid, p]) => ({ pid, startTicks: p.startTicks }));
  }
  start(pid: number, over: Partial<ProcIdentity> = {}) {
    this.table.set(pid, { startTicks: 1000, cmdline: "opencode acp", pgrp: pid, ...over });
  }
}

function setup() {
  const file = join(tempDir("fd-ledger-"), "opencode-groups.json");
  const proc = new FakeProc();
  const killed: Array<[number, string]> = [];
  const make = () =>
    new ProcessLedger({
      file,
      proc,
      killGroup: (pgid, signal) => {
        killed.push([pgid, signal]);
      },
    });
  return { file, proc, killed, ledger: make(), make };
}

describe("opencode-ledger: the process groups the daemon starts (issue #250)", () => {
  test("add writes the leader's pid, start and command line to the file; an unknown process writes nothing", () => {
    const { file, proc, ledger } = setup();
    proc.start(4242);
    ledger.add(4242);
    ledger.add(9999);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual([
      { pid: 4242, startTicks: 1000, cmdline: "opencode acp" },
    ]);
    expect(ledger.size).toBe(1);
  });

  test("a leader still there with the same start and command is killed with its group, then forgotten", () => {
    const { proc, killed, ledger, make } = setup();
    proc.start(4242);
    ledger.add(4242);
    const next = make();
    expect(next.reap()).toEqual({ reaped: [4242], stale: [] });
    expect(killed).toEqual([[4242, "SIGKILL"]]);
    expect(next.size).toBe(0);
    expect(make().reap()).toEqual({ reaped: [], stale: [] });
  });

  test("a leader gone but its group alive (the orphaned command): the group is killed", () => {
    const { proc, killed, ledger, make } = setup();
    proc.start(4242);
    ledger.add(4242);
    proc.table.delete(4242);
    proc.start(4300, { pgrp: 4242, startTicks: 1500, cmdline: "sleep 600" });
    expect(make().reap()).toEqual({ reaped: [4242], stale: [] });
    expect(killed).toEqual([[4242, "SIGKILL"]]);
  });

  test("a group member older than the leader is not from that group: nothing is killed", () => {
    const { proc, killed, ledger, make } = setup();
    proc.start(4242);
    ledger.add(4242);
    proc.table.delete(4242);
    proc.start(4300, { pgrp: 4242, startTicks: 500 });
    expect(make().reap()).toEqual({ reaped: [], stale: [4242] });
    expect(killed).toEqual([]);
  });

  test("the pid taken by another process (other start, or other command) is not killed", () => {
    for (const other of [{ startTicks: 2000 }, { cmdline: "vim notes.txt" }]) {
      const { proc, killed, ledger, make } = setup();
      proc.start(4242);
      ledger.add(4242);
      proc.start(4242, other);
      expect(make().reap()).toEqual({ reaped: [], stale: [4242] });
      expect(killed).toEqual([]);
    }
  });

  test("a leader that is not the leader of its own group is never signalled as a group", () => {
    const { proc, killed, ledger, make } = setup();
    proc.start(4242);
    ledger.add(4242);
    proc.start(4242, { pgrp: 1 });
    expect(make().reap()).toEqual({ reaped: [], stale: [4242] });
    expect(killed).toEqual([]);
  });

  test("nothing left of the group: the entry is dropped as stale", () => {
    const { proc, killed, ledger, make } = setup();
    proc.start(4242);
    ledger.add(4242);
    proc.table.delete(4242);
    expect(make().reap()).toEqual({ reaped: [], stale: [4242] });
    expect(killed).toEqual([]);
  });

  test("a group that is already gone when the signal arrives (ESRCH) is not an error", () => {
    const file = join(tempDir("fd-ledger-"), "g.json");
    const proc = new FakeProc();
    proc.start(7);
    const make = () =>
      new ProcessLedger({
        file,
        proc,
        killGroup: () => {
          throw Object.assign(new Error("no such process"), { code: "ESRCH" });
        },
      });
    make().add(7);
    expect(make().reap()).toEqual({ reaped: [7], stale: [] });
  });

  test("release kills what is left of the group and forgets it; an unknown pid is nothing", () => {
    const { proc, killed, ledger } = setup();
    proc.start(4242);
    ledger.add(4242);
    ledger.release(1);
    expect(ledger.size).toBe(1);
    proc.table.delete(4242);
    proc.start(4300, { pgrp: 4242, startTicks: 1500 });
    ledger.release(4242);
    expect(killed).toEqual([[4242, "SIGKILL"]]);
    expect(ledger.size).toBe(0);
  });

  test("release of a group that left nothing kills nothing", () => {
    const { proc, killed, ledger } = setup();
    proc.start(4242);
    ledger.add(4242);
    proc.table.delete(4242);
    ledger.release(4242);
    expect(killed).toEqual([]);
    expect(ledger.size).toBe(0);
  });

  test("a missing, empty or damaged file is an empty ledger, never an error", () => {
    const { file, make } = setup();
    expect(make().reap()).toEqual({ reaped: [], stale: [] });
    writeFileSync(file, "not json");
    expect(make().reap()).toEqual({ reaped: [], stale: [] });
    writeFileSync(file, '{"pid":1}');
    expect(make().reap()).toEqual({ reaped: [], stale: [] });
    writeFileSync(file, '[{"pid":"x"}, 5, null]');
    expect(make().reap()).toEqual({ reaped: [], stale: [] });
  });

  test("an empty ledger leaves no file behind to read next time", () => {
    const { file, proc, ledger } = setup();
    proc.start(4242);
    ledger.add(4242);
    ledger.release(4242);
    expect(existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : []).toEqual([]);
  });
});

describe("opencode-ledger: what /proc says", () => {
  test("parseStat reads the group and the start even when the command has spaces and parentheses", () => {
    const line =
      "4242 (open (code) acp) S 1 4242 4242 0 -1 4194560 100 0 0 0 1 2 0 0 20 0 5 0 987654 1000 100 18446744073709551615";
    expect(parseStat(line)).toEqual({ pgrp: 4242, startTicks: 987654 });
    expect(parseStat("garbage")).toBeNull();
    expect(parseStat("1 (x) S 1")).toBeNull();
  });

  test("outside Linux nothing is known", () => {
    const none = procSource("win32");
    expect(none.identity(process.pid)).toBeNull();
    expect(none.members(process.pid)).toEqual([]);
  });

  test.skipIf(process.platform !== "linux")(
    "a real group: a child that leads its own group is found by its start and command, and reaped after the 'crash'",
    async () => {
      const file = join(tempDir("fd-ledger-"), "g.json");
      const real = procSource("linux");
      const child = Bun.spawn(["sleep", "60"], {
        detached: true,
        stdout: "ignore",
        stderr: "ignore",
      });
      const kills: number[] = [];
      try {
        const identity = real.identity(child.pid);
        expect(identity?.pgrp).toBe(child.pid);
        expect(identity?.cmdline).toBe("sleep 60");
        expect(real.members(child.pid).map((m) => m.pid)).toContain(child.pid);
        new ProcessLedger({ file, proc: real, killGroup: () => {} }).add(child.pid);
        // The next daemon start: the same child is still there, so its group is signalled.
        const next = new ProcessLedger({
          file,
          proc: real,
          killGroup: (pgid, signal) => {
            kills.push(pgid);
            process.kill(-pgid, signal);
          },
        });
        expect(next.reap()).toEqual({ reaped: [child.pid], stale: [] });
        expect(await child.exited).not.toBe(0);
        expect(kills).toEqual([child.pid]);
      } finally {
        child.kill("SIGKILL");
      }
    },
  );
});
