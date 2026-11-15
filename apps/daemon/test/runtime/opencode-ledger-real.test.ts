import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ProcessLedger, procSource } from "../../src/runtime/process-ledger.ts";
import { poll, tempDir } from "../support/helpers.ts";

describe("opencode-ledger: a real process group", () => {
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
