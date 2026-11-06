import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ProcessLedger,
  type ProcIdentity,
  type ProcSource,
  parseStat,
  procSource,
} from "../src/runtime/process-ledger.ts";
import { poll, tempDir } from "./helpers.ts";

/** A pretend /proc: processes by pid, each with its group and start. */
class FakeProc implements ProcSource {
  readonly table = new Map<number, ProcIdentity>();
  boot: string | null = "boot-1";
  bootId() {
    return this.boot;
  }
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
  test("add writes the leader's pid, start and command line to the file; an unknown process writes nothing", async () => {
    const { file, proc, ledger } = setup();
    proc.start(4242);
    await ledger.add(4242);
    await ledger.add(9999);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual([
      { pid: 4242, startTicks: 1000, cmdline: "opencode acp", bootId: "boot-1" },
    ]);
    expect(await ledger.count()).toBe(1);
  });

  test("a pid written twice (a process started again under the same pid) is one entry, the latest", async () => {
    const { file, proc, ledger } = setup();
    proc.start(4242);
    await ledger.add(4242);
    proc.start(4242, { startTicks: 2000 });
    await ledger.add(4242);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual([
      { pid: 4242, startTicks: 2000, cmdline: "opencode acp", bootId: "boot-1" },
    ]);
  });

  test("a leader still there with the same start and command is killed with its group, then forgotten", async () => {
    const { proc, killed, ledger, make } = setup();
    proc.start(4242);
    await ledger.add(4242);
    const next = make();
    expect(await next.reap()).toEqual({ reaped: [4242], stale: [] });
    expect(killed).toEqual([[4242, "SIGKILL"]]);
    expect(await next.count()).toBe(0);
    expect(await make().reap()).toEqual({ reaped: [], stale: [] });
  });

  test("a leader gone but its group alive (the orphaned command): the group is killed", async () => {
    const { proc, killed, ledger, make } = setup();
    proc.start(4242);
    await ledger.add(4242);
    proc.table.delete(4242);
    proc.start(4300, { pgrp: 4242, startTicks: 1500, cmdline: "sleep 600" });
    expect(await make().reap()).toEqual({ reaped: [4242], stale: [] });
    expect(killed).toEqual([[4242, "SIGKILL"]]);
  });

  test("a group member older than the leader is not from that group: nothing is killed", async () => {
    const { proc, killed, ledger, make } = setup();
    proc.start(4242);
    await ledger.add(4242);
    proc.table.delete(4242);
    proc.start(4300, { pgrp: 4242, startTicks: 500 });
    expect(await make().reap()).toEqual({ reaped: [], stale: [4242] });
    expect(killed).toEqual([]);
  });

  test("the pid taken by another process (other start, or other command) is not killed", async () => {
    for (const other of [{ startTicks: 2000 }, { cmdline: "vim notes.txt" }]) {
      const { proc, killed, ledger, make } = setup();
      proc.start(4242);
      await ledger.add(4242);
      proc.start(4242, other);
      expect(await make().reap()).toEqual({ reaped: [], stale: [4242] });
      expect(killed).toEqual([]);
    }
  });

  test("a leader that is not the leader of its own group is never signalled as a group", async () => {
    const { proc, killed, ledger, make } = setup();
    proc.start(4242);
    await ledger.add(4242);
    proc.start(4242, { pgrp: 1 });
    expect(await make().reap()).toEqual({ reaped: [], stale: [4242] });
    expect(killed).toEqual([]);
  });

  test("nothing left of the group: the entry is dropped as stale", async () => {
    const { proc, killed, ledger, make } = setup();
    proc.start(4242);
    await ledger.add(4242);
    proc.table.delete(4242);
    expect(await make().reap()).toEqual({ reaped: [], stale: [4242] });
    expect(killed).toEqual([]);
  });

  test("a group that is already gone when the signal arrives (ESRCH) is not an error", async () => {
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
    await make().add(7);
    expect(await make().reap()).toEqual({ reaped: [7], stale: [] });
  });

  test("release kills what is left of the group and forgets it; an unknown pid is nothing", async () => {
    const { proc, killed, ledger } = setup();
    proc.start(4242);
    await ledger.add(4242);
    await ledger.release(1);
    expect(await ledger.count()).toBe(1);
    proc.table.delete(4242);
    proc.start(4300, { pgrp: 4242, startTicks: 1500 });
    await ledger.release(4242);
    expect(killed).toEqual([[4242, "SIGKILL"]]);
    expect(await ledger.count()).toBe(0);
  });

  test("release of a group that left nothing kills nothing", async () => {
    const { proc, killed, ledger } = setup();
    proc.start(4242);
    await ledger.add(4242);
    proc.table.delete(4242);
    await ledger.release(4242);
    expect(killed).toEqual([]);
    expect(await ledger.count()).toBe(0);
  });

  test("a missing, empty or damaged file is an empty ledger, never an error", async () => {
    const { file, make } = setup();
    expect(await make().reap()).toEqual({ reaped: [], stale: [] });
    writeFileSync(file, "not json");
    expect(await make().reap()).toEqual({ reaped: [], stale: [] });
    writeFileSync(file, '{"pid":1}');
    expect(await make().reap()).toEqual({ reaped: [], stale: [] });
    writeFileSync(file, '[{"pid":"x"}, 5, null]');
    expect(await make().reap()).toEqual({ reaped: [], stale: [] });
  });

  test("an entry from another boot is stale: start ticks begin again at zero after a reboot", async () => {
    const { proc, killed, ledger, make } = setup();
    proc.start(4242);
    await ledger.add(4242);
    proc.boot = "boot-2";
    expect(await make().reap()).toEqual({ reaped: [], stale: [4242] });
    expect(killed).toEqual([]);
  });

  test("no boot id to check against: nothing is written down", async () => {
    const { proc, ledger } = setup();
    proc.boot = null;
    proc.start(4242);
    await ledger.add(4242);
    expect(await ledger.count()).toBe(0);
  });

  test("an entry the file could not have from add is dropped unread: pid 0, 1 or negative, a fraction, a negative start, no boot id", async () => {
    const { file, proc, killed, make } = setup();
    // Each would reach a real group with the earlier checks: pid 1 matches init, pid 0 a group 0 member.
    proc.start(1, { startTicks: 7, cmdline: "init" });
    proc.start(77, { pgrp: 0, startTicks: 5 });
    proc.start(4242);
    const entry = { startTicks: 0, cmdline: "init", bootId: "boot-1" };
    writeFileSync(
      file,
      JSON.stringify([
        { ...entry, pid: 1, startTicks: 7 },
        { ...entry, pid: 0 },
        { ...entry, pid: -77 },
        { ...entry, pid: 4242.5 },
        { pid: 4242, startTicks: -1, cmdline: "opencode acp", bootId: "boot-1" },
        { pid: 4242, startTicks: 1000, cmdline: "opencode acp" },
      ]),
    );
    expect(await make().reap()).toEqual({ reaped: [], stale: [] });
    expect(killed).toEqual([]);
  });

  test("the daemon's own group, or its own pid, is never killed", async () => {
    const { file, proc, killed, make } = setup();
    proc.start(process.pid, { cmdline: "flightdeckd", pgrp: 4000 });
    proc.start(4001, { pgrp: 4000, startTicks: 2000 });
    const own = { startTicks: 1000, cmdline: "flightdeckd", bootId: "boot-1" };
    writeFileSync(
      file,
      JSON.stringify([
        { ...own, pid: 4000 },
        { ...own, pid: process.pid },
      ]),
    );
    expect(await make().reap()).toEqual({ reaped: [], stale: [4000, process.pid] });
    // and a daemon that leads its own group
    proc.start(process.pid, { cmdline: "flightdeckd" });
    writeFileSync(file, JSON.stringify([{ ...own, pid: process.pid }]));
    expect(await make().reap()).toEqual({ reaped: [], stale: [process.pid] });
    expect(killed).toEqual([]);
  });

  test("an empty ledger leaves no file behind to read next time", async () => {
    const { file, proc, ledger } = setup();
    proc.start(4242);
    await ledger.add(4242);
    await ledger.release(4242);
    expect(existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : []).toEqual([]);
  });
});

describe("opencode-ledger: what /proc says", () => {
  test("parseStat reads the group and the start even when the command has spaces and parentheses", async () => {
    const line =
      "4242 (open (code) acp) S 1 4242 4242 0 -1 4194560 100 0 0 0 1 2 0 0 20 0 5 0 987654 1000 100 18446744073709551615";
    expect(parseStat(line)).toEqual({ pgrp: 4242, startTicks: 987654 });
    expect(parseStat("garbage")).toBeNull();
    expect(parseStat("1 (x) S 1")).toBeNull();
  });

  test("outside Linux nothing is known", async () => {
    const none = procSource("win32");
    expect(none.identity(process.pid)).toBeNull();
    expect(none.members(process.pid)).toEqual([]);
    expect(none.bootId()).toBeNull();
  });

  test("a real group on Linux: a child that leads its own group is written down and reaped after the 'crash'; elsewhere nothing is written down", async () => {
    const file = join(tempDir("fd-ledger-"), "g.json");
    const linux = process.platform === "linux";
    const real = procSource();
    // Bun itself as the child, so the test runs on every system; on Linux it leads its own group.
    const child = Bun.spawn([process.execPath, "-e", "setTimeout(() => {}, 60000)"], {
      detached: true,
      stdout: "ignore",
      stderr: "ignore",
    });
    const kills: number[] = [];
    try {
      // Just after the spawn the child may still show its parent's command: wait for the exec.
      const cmdline = `/proc/${child.pid}/cmdline`;
      await poll(
        () =>
          !linux || (existsSync(cmdline) && readFileSync(cmdline, "utf8").includes("setTimeout")),
        5000,
      );
      const identity = await real.identity(child.pid);
      expect(identity === null).toBe(!linux);
      if (identity) {
        expect(identity.pgrp).toBe(child.pid);
        expect((await real.members(child.pid)).map((m) => m.pid)).toContain(child.pid);
      }
      await new ProcessLedger({ file, proc: real, killGroup: () => {} }).add(child.pid);
      // The next daemon start: the same child is still there, so its group is signalled.
      const next = new ProcessLedger({
        file,
        proc: real,
        killGroup: (pgid, signal) => {
          kills.push(pgid);
          process.kill(-pgid, signal);
        },
      });
      expect(await next.reap()).toEqual({ reaped: linux ? [child.pid] : [], stale: [] });
      expect(kills).toEqual(linux ? [child.pid] : []);
      if (linux) expect(await child.exited).not.toBe(0);
    } finally {
      child.kill("SIGKILL");
    }
  });
});
