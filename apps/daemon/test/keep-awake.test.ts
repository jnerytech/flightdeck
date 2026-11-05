import { describe, expect, test } from "bun:test";
import {
  type Holder,
  holderCommand,
  KeepAwake,
  osPowerContext,
  type PowerContext,
  spawnHolder,
} from "../src/power/keep-awake.ts";

/** A power context that records what was started and killed, and starts nothing real. */
function fakeContext(over: Partial<PowerContext> & { present?: string[] } = {}) {
  const started: string[][] = [];
  const killed: string[][] = [];
  const exits: Array<() => void> = [];
  const { present = ["systemd-inhibit"], ...rest } = over;
  const ctx: PowerContext = {
    platform: "linux",
    pid: 4242,
    which: (name) => (present.includes(name) ? `/usr/bin/${name}` : null),
    hold: (cmd) => {
      started.push(cmd);
      let end = () => {};
      const exited = new Promise<void>((resolve) => {
        end = resolve;
      });
      exits.push(end);
      const holder: Holder = {
        kill: () => {
          killed.push(cmd);
          end();
        },
        exited,
      };
      return holder;
    },
    ...rest,
  };
  return { ctx, started, killed, exits };
}

describe("keep-awake: the command that holds the computer awake on each system", () => {
  test("Linux asks systemd-inhibit to block idle and sleep until the daemon is gone", () => {
    const found = holderCommand(fakeContext().ctx);
    expect(found).toMatchObject({ method: "systemd-inhibit" });
    const cmd = "cmd" in found ? found.cmd : [];
    expect(cmd[0]).toBe("/usr/bin/systemd-inhibit");
    expect(cmd).toContain("--what=idle:sleep");
    expect(cmd).toContain("--mode=block");
    expect(cmd.join(" ")).toContain("tail --pid=4242");
  });

  test("macOS runs caffeinate for as long as the daemon lives", () => {
    const found = holderCommand(fakeContext({ platform: "darwin", present: ["caffeinate"] }).ctx);
    expect(found).toEqual({
      method: "caffeinate",
      cmd: ["/usr/bin/caffeinate", "-i", "-w", "4242"],
    });
  });

  test("Windows runs PowerShell with SetThreadExecutionState, pwsh first, until the daemon is gone", () => {
    const both = holderCommand(
      fakeContext({ platform: "win32", present: ["pwsh", "powershell"] }).ctx,
    );
    expect(both).toMatchObject({ method: "powershell" });
    const cmd = "cmd" in both ? both.cmd : [];
    expect(cmd[0]).toBe("/usr/bin/pwsh");
    expect(cmd.join(" ")).toContain("SetThreadExecutionState");
    expect(cmd.join(" ")).toContain("0x80000001");
    expect(cmd.join(" ")).toContain("4242");
    const only = holderCommand(fakeContext({ platform: "win32", present: ["powershell"] }).ctx);
    expect("cmd" in only ? only.cmd[0] : "").toBe("/usr/bin/powershell");
  });

  test("a system without the program, or one that is not known, gives a reason and no command", () => {
    expect(holderCommand(fakeContext({ present: [] }).ctx)).toEqual({ reason: "no-inhibitor" });
    expect(holderCommand(fakeContext({ platform: "win32", present: [] }).ctx)).toEqual({
      reason: "no-inhibitor",
    });
    expect(holderCommand(fakeContext({ platform: "freebsd" }).ctx)).toEqual({
      reason: "unsupported-platform",
    });
  });
});

describe("keep-awake: held while a session runs or waits for a permission, and not otherwise", () => {
  test("it holds with one active session, once for any number, and lets go when the last one ends", () => {
    const { ctx, started, killed } = fakeContext();
    const awake = new KeepAwake(ctx);
    expect(awake.status()).toEqual({ enabled: true, held: false, method: null, reason: null });
    awake.update(0);
    expect(started).toHaveLength(0);
    awake.update(1);
    expect(awake.status()).toMatchObject({ held: true, method: "systemd-inhibit", reason: null });
    awake.update(3);
    awake.update(2);
    expect(started).toHaveLength(1);
    awake.update(0);
    expect(killed).toHaveLength(1);
    expect(awake.status()).toMatchObject({ held: false, method: null });
    awake.update(1);
    expect(started).toHaveLength(2);
  });

  test("with the setting off it never holds, turning it off lets go, and turning it on holds again if a session runs", () => {
    const { ctx, started, killed } = fakeContext();
    const off = new KeepAwake(ctx, false);
    off.update(2);
    expect(started).toHaveLength(0);
    expect(off.status()).toMatchObject({ enabled: false, held: false });
    off.setEnabled(true);
    expect(started).toHaveLength(1);
    off.setEnabled(false);
    expect(killed).toHaveLength(1);
    expect(off.status()).toMatchObject({ enabled: false, held: false });
    off.setEnabled(true);
    expect(started).toHaveLength(2);
  });

  test("stopping the daemon lets go, and a later update holds nothing", () => {
    const { ctx, started, killed } = fakeContext();
    const awake = new KeepAwake(ctx);
    awake.update(1);
    awake.stop();
    expect(killed).toHaveLength(1);
    awake.update(1);
    expect(started).toHaveLength(1);
    expect(awake.status().held).toBe(false);
  });

  test("a system with no way to hold says why, and asks nothing of the context", () => {
    const { ctx, started } = fakeContext({ present: [] });
    const awake = new KeepAwake(ctx);
    awake.update(1);
    expect(started).toHaveLength(0);
    expect(awake.status()).toMatchObject({ held: false, reason: "no-inhibitor" });
    awake.update(0);
    expect(awake.status().reason).toBeNull();
  });

  test("a holder that cannot start, or throws, is said as start-failed and is not retried until the sessions stop and begin again", () => {
    for (const hold of [
      () => null,
      () => {
        throw new Error("spawn ENOENT");
      },
    ]) {
      let asked = 0;
      const { ctx } = fakeContext({
        hold: () => {
          asked++;
          return hold();
        },
      });
      const awake = new KeepAwake(ctx);
      awake.update(1);
      awake.update(2);
      expect(asked).toBe(1);
      expect(awake.status()).toMatchObject({ held: false, reason: "start-failed" });
      awake.update(0);
      awake.update(1);
      expect(asked).toBe(2);
    }
  });

  test("a holder that ends by itself leaves held false with the reason ended, until the sessions begin again", async () => {
    const { ctx, started, exits } = fakeContext();
    const awake = new KeepAwake(ctx);
    awake.update(1);
    exits[0]?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(awake.status()).toMatchObject({ held: false, reason: "ended" });
    awake.update(2);
    expect(started).toHaveLength(1);
    awake.update(0);
    awake.update(1);
    expect(started).toHaveLength(2);
    expect(awake.status()).toMatchObject({ held: true, reason: null });
  });
});

describe("keep-awake: the real context starts a child process and ends it", () => {
  test("spawnHolder runs the command, kill ends it and exited resolves; a command that cannot start gives null", async () => {
    const holder = spawnHolder([process.execPath, "-e", "setInterval(() => {}, 1000)"]);
    expect(holder).not.toBeNull();
    holder?.kill();
    await holder?.exited;
    expect(spawnHolder(["/no/such/program-for-keep-awake"])).toBeNull();
  });

  test("the OS context reports this system", () => {
    const ctx = osPowerContext();
    expect(ctx.platform).toBe(process.platform);
    expect(ctx.pid).toBe(process.pid);
    expect(ctx.which("a-program-that-is-not-here-anywhere")).toBeNull();
    expect(ctx.hold).toBe(spawnHolder);
  });
});
