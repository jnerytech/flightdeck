import { describe, expect, test } from "bun:test";
import {
  type Holder,
  holderCommand,
  KeepAwake,
  osPowerContext,
  type PowerContext,
  spawnHolder,
  windowsScript,
} from "../src/power/keep-awake.ts";

/** A power context that records what was started and killed, and starts nothing real. */
function fakeContext(over: Partial<PowerContext> & { present?: string[] } = {}) {
  const started: string[][] = [];
  const killed: string[][] = [];
  const exits: Array<() => void> = [];
  const { present = ["systemd-inhibit", "tail"], ...rest } = over;
  const ctx: PowerContext = {
    platform: "linux",
    pid: 4242,
    wsl: false,
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

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("keep-awake: the command that holds the computer awake on each system", () => {
  test("Linux asks systemd-inhibit to block idle and sleep until the daemon is gone", () => {
    const found = holderCommand(fakeContext().ctx);
    expect(found).toMatchObject({ method: "systemd-inhibit" });
    const cmd = "cmd" in found ? found.cmd : [];
    expect(cmd[0]).toBe("/usr/bin/systemd-inhibit");
    expect(cmd).toContain("--what=idle:sleep");
    expect(cmd).toContain("--mode=block");
    // tail is found on the PATH like the inhibitor, not left to the inhibitor's own lookup.
    expect(cmd.slice(-4)).toEqual(["/usr/bin/tail", "--pid=4242", "-f", "/dev/null"]);
  });

  test("macOS runs caffeinate for as long as the daemon lives", () => {
    const found = holderCommand(fakeContext({ platform: "darwin", present: ["caffeinate"] }).ctx);
    expect(found).toEqual({
      method: "caffeinate",
      cmd: ["/usr/bin/caffeinate", "-i", "-w", "4242"],
    });
  });

  test("Windows runs PowerShell, pwsh first, with the script as an encoded command", () => {
    const both = holderCommand(
      fakeContext({ platform: "win32", present: ["pwsh", "powershell"] }).ctx,
    );
    expect(both).toMatchObject({ method: "powershell" });
    const cmd = "cmd" in both ? both.cmd : [];
    expect(cmd.slice(0, 4)).toEqual([
      "/usr/bin/pwsh",
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
    ]);
    expect(cmd).toHaveLength(5);
    // The script travels as base64 of UTF-16LE: no quote of its own depends on Windows argv quoting.
    expect(Buffer.from(cmd[4] ?? "", "base64").toString("utf16le")).toBe(windowsScript(4242));
    const only = holderCommand(fakeContext({ platform: "win32", present: ["powershell"] }).ctx);
    expect("cmd" in only ? only.cmd[0] : "").toBe("/usr/bin/powershell");
  });

  test("the script stops on its first error, sets ES_CONTINUOUS | ES_SYSTEM_REQUIRED as a decimal uint, and watches the daemon's pid", () => {
    const script = windowsScript(4242);
    // 0x80000001 is a negative Int32 in PowerShell and does not convert to the uint parameter.
    expect(script).not.toContain("0x80000001");
    expect(script.startsWith("$ErrorActionPreference = 'Stop';")).toBe(true);
    expect(script).toContain("SetThreadExecutionState(2147483649)");
    expect(script).toContain("Get-Process -Id 4242 -ErrorAction SilentlyContinue");
    expect(() => windowsScript(Number.NaN)).toThrow();
    expect(() => windowsScript(4242.5)).toThrow();
  });

  test.skipIf(process.platform !== "win32")(
    "on Windows the real script holds: it stays alive while the daemon's pid lives, and leaves after it",
    async () => {
      const helper = Bun.spawn([process.execPath, "-e", "setTimeout(() => {}, 4000)"], {
        stdout: "ignore",
        stderr: "ignore",
      });
      const found = holderCommand({
        platform: "win32",
        pid: helper.pid,
        which: (name) => Bun.which(name),
      });
      expect("cmd" in found).toBe(true);
      const holder = spawnHolder("cmd" in found ? found.cmd : []);
      expect(holder).not.toBeNull();
      let ended = false;
      void holder?.exited.then(() => {
        ended = true;
      });
      // Add-Type takes a moment; if SetThreadExecutionState failed, the script would have exited by now.
      await Bun.sleep(2500);
      expect(ended).toBe(false);
      await helper.exited;
      await Promise.race([holder?.exited, Bun.sleep(15_000)]);
      expect(ended).toBe(true);
    },
  );

  test("a system without the program, or one that is not known, gives a reason and no command", () => {
    expect(holderCommand(fakeContext({ present: [] }).ctx)).toEqual({ reason: "no-inhibitor" });
    expect(holderCommand(fakeContext({ platform: "win32", present: [] }).ctx)).toEqual({
      reason: "no-inhibitor",
    });
    expect(holderCommand(fakeContext({ platform: "freebsd" }).ctx)).toEqual({
      reason: "unsupported-platform",
    });
    // Busybox tail has no --pid and a minimal container may have none: a clean reason, not an early exit.
    expect(holderCommand(fakeContext({ present: ["systemd-inhibit"] }).ctx)).toEqual({
      reason: "no-inhibitor",
    });
  });

  test("inside WSL nothing is held: a Linux inhibitor there does not stop Windows from sleeping", () => {
    const { ctx, started } = fakeContext({ wsl: true });
    expect(holderCommand(ctx)).toEqual({ reason: "wsl" });
    const awake = new KeepAwake(ctx);
    awake.update(1);
    expect(started).toHaveLength(0);
    expect(awake.status()).toMatchObject({ held: false, reason: "wsl" });
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
    await flush();
    expect(awake.status()).toMatchObject({ held: false, reason: "ended" });
    awake.update(2);
    expect(started).toHaveLength(1);
    awake.update(0);
    awake.update(1);
    expect(started).toHaveLength(2);
    expect(awake.status()).toMatchObject({ held: true, reason: null });
  });
});

describe("keep-awake: the late end of an old holder and the setting while it is latched", () => {
  test("a stop and a start in a row: the old holder's late exit is ignored, and the new one is held", async () => {
    const { ctx, started } = fakeContext();
    const awake = new KeepAwake(ctx);
    awake.update(1);
    awake.update(0);
    awake.update(1);
    await flush();
    expect(started).toHaveLength(2);
    expect(awake.status()).toMatchObject({ held: true, reason: null });
  });

  test("turning it off while a failure is latched clears the reason, and turning it on tries again", () => {
    let asked = 0;
    const { ctx } = fakeContext({
      hold: () => {
        asked++;
        return null;
      },
    });
    const awake = new KeepAwake(ctx);
    awake.update(1);
    expect(awake.status().reason).toBe("start-failed");
    awake.setEnabled(false);
    expect(awake.status()).toMatchObject({ enabled: false, reason: null });
    awake.setEnabled(true);
    expect(asked).toBe(2);
    expect(awake.status().reason).toBe("start-failed");
    awake.setEnabled(false);
    awake.update(0);
    expect(awake.status()).toMatchObject({ held: false, reason: null });
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
    expect(typeof ctx.wsl).toBe("boolean");
  });
});
