import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { parseArgs } from "../../src/main.ts";
import { CLOSE, fakeDaemon, type Handlers, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

/** What the parser makes of a line: the arguments, or the refusal's first line (so a red is an assertion). */
const parsed = (argv: string[]): Record<string, unknown> => {
  try {
    return { ...parseArgs(argv) };
  } catch (error) {
    return { refusal: String((error as Error).message).split("\n")[0] };
  }
};

const refused = (argv: string[]) => "refusal" in parsed(argv);

describe("the host verbs of the command line (issue #3699)", () => {
  test("`host sleep` takes whole minutes from 0 to 1440", () => {
    expect(parsed(["host", "sleep", "30"])).toMatchObject({
      command: "host",
      action: "sleep",
      hostMinutes: 30,
    });
    expect(parsed(["host", "sleep", "0"])).toMatchObject({ hostMinutes: 0 });
    expect(parsed(["host", "sleep", "1440"])).toMatchObject({ hostMinutes: 1440 });
    for (const bad of ["1441", "-1", "1e2", "0x10", " 5", "5.5", "abc", ""]) {
      expect(refused(["host", "sleep", bad])).toBe(true);
    }
    expect(refused(["host", "sleep"])).toBe(true);
    expect(refused(["host", "sleep", "30", "extra"])).toBe(true);
  });

  test("keep-awake, pause, updates and bypass take on or off, and nothing else", () => {
    for (const verb of ["keep-awake", "pause", "updates", "bypass"]) {
      expect(parsed(["host", verb, "on"])).toMatchObject({
        command: "host",
        action: verb,
        hostSwitch: "on",
      });
      expect(parsed(["host", verb, "off"])).toMatchObject({ action: verb, hostSwitch: "off" });
      expect(refused(["host", verb, "maybe"])).toBe(true);
      expect(refused(["host", verb, "ON"])).toBe(true);
      expect(refused(["host", verb])).toBe(true);
    }
  });

  test("a bare `host` still asks for the host's facts, and a word that is no verb is refused", () => {
    expect(parsed(["host"])).toMatchObject({ command: "host" });
    expect(parsed(["host", "--json"])).toMatchObject({ command: "host", json: true });
    expect((parsed(["host"]) as { action?: string }).action).toBeUndefined();
    expect(refused(["host", "reboot"])).toBe(true);
  });

  test("--host and --json go with a verb, and --confirm only with `bypass on`", () => {
    expect(parsed(["--host", "pi", "host", "sleep", "30"])).toMatchObject({
      host: "pi",
      action: "sleep",
    });
    expect(parsed(["host", "pause", "on", "--json"])).toMatchObject({ json: true });
    expect(parsed(["host", "bypass", "on", "--confirm"])).toMatchObject({
      action: "bypass",
      hostSwitch: "on",
      confirm: true,
    });
    expect(refused(["host", "bypass", "off", "--confirm"])).toBe(true);
    expect(refused(["host", "sleep", "30", "--confirm"])).toBe(true);
    expect(refused(["host", "--confirm"])).toBe(true);
  });
});

const KEEP_AWAKE = { enabled: true, held: true, method: "systemd-inhibit", reason: null };
const base = (over: Handlers = {}): Handlers => ({
  "host.sleep": (p) => ({ sleepAfterMinutes: p.minutes }),
  "host.keepAwake": (p) => ({ ...KEEP_AWAKE, enabled: p.enabled }),
  "host.pause": (p) => ({ paused: p.paused, running: 2 }),
  "host.updates.set": (p) => ({ enabled: p.auto, state: p.auto ? "current" : "off" }),
  "host.bypass": (p) => ({ allowBypassPermissions: p.allow }),
  ...over,
});
const sent = (daemon: ReturnType<typeof fakeDaemon>, type: string) =>
  daemon.calls.filter((c) => c.type === type).map((c) => c.payload);

describe("flightdeckd host <verb> (issue #3699)", () => {
  test("sleep sends the minutes and prints what the host keeps", async () => {
    const daemon = fakeDaemon(base());
    const run = await flightdeckd(["host", "sleep", "30"], daemon.port);
    expect({ code: run.code, err: run.err }).toEqual({ code: 0, err: [] });
    expect(run.out).toEqual(["sleep  idle sessions sleep after 30 minutes"]);
    expect(sent(daemon, "host.sleep")).toEqual([{ minutes: 30 }]);
    const off = await flightdeckd(["host", "sleep", "0"], daemon.port);
    expect(off.out).toEqual(["sleep  off"]);
    const one = await flightdeckd(["host", "sleep", "1"], daemon.port);
    expect(one.out).toEqual(["sleep  idle sessions sleep after 1 minute"]);
  });

  test("--json prints the daemon's value, one object", async () => {
    const daemon = fakeDaemon(base());
    const run = await flightdeckd(["host", "sleep", "30", "--json"], daemon.port);
    expect(run.code).toBe(0);
    expect(JSON.parse(run.out.join("\n"))).toEqual({ sleepAfterMinutes: 30 });
    const pause = await flightdeckd(["host", "pause", "on", "--json"], daemon.port);
    expect(pause.code).toBe(0);
    expect(JSON.parse(pause.out.join("\n"))).toEqual({ paused: true, running: 2 });
  });

  test("keep-awake says whether the computer is held, and a host with no keep-awake exits 1 with its text", async () => {
    const daemon = fakeDaemon(base());
    const on = await flightdeckd(["host", "keep-awake", "on"], daemon.port);
    expect(on.out).toEqual(["keep-awake  on  held (systemd-inhibit)"]);
    expect(sent(daemon, "host.keepAwake")).toEqual([{ enabled: true }]);
    const off = await flightdeckd(["host", "keep-awake", "off"], daemon.port);
    expect(off.out).toEqual(["keep-awake  off"]);
    const unheld = fakeDaemon(
      base({
        "host.keepAwake": () => ({
          enabled: true,
          held: false,
          method: null,
          reason: "no-inhibitor",
        }),
      }),
    );
    const notHeld = await flightdeckd(["host", "keep-awake", "on"], unheld.port);
    expect(notHeld.out).toEqual(["keep-awake  on  not held (no-inhibitor)"]);
    const none = fakeDaemon({
      "host.keepAwake": () => ({
        error: { code: "feature_off", message: "keepAwake is not available on this host" },
      }),
    });
    const refused = await flightdeckd(["host", "keep-awake", "on"], none.port);
    expect([refused.code, refused.err.join("\n")]).toEqual([
      1,
      expect.stringContaining("keepAwake is not available"),
    ]);
  });

  test("pause and updates send their switch and print the new state", async () => {
    const daemon = fakeDaemon(base());
    const pause = await flightdeckd(["host", "pause", "on"], daemon.port);
    expect(pause.out).toEqual(["pause  on  (2 sessions still running)"]);
    expect(sent(daemon, "host.pause")).toEqual([{ paused: true }]);
    expect((await flightdeckd(["host", "pause", "off"], daemon.port)).out).toEqual(["pause  off"]);
    const updates = await flightdeckd(["host", "updates", "on"], daemon.port);
    expect(updates.out).toEqual(["updates  automatic on  (current)"]);
    expect(sent(daemon, "host.updates.set")).toEqual([{ auto: true }]);
    expect((await flightdeckd(["host", "updates", "off"], daemon.port)).out).toEqual([
      "updates  automatic off",
    ]);
  });

  test("bypass off needs no --confirm; bypass on sends the word only when it is given", async () => {
    const daemon = fakeDaemon(base());
    const off = await flightdeckd(["host", "bypass", "off"], daemon.port);
    expect(off.out).toEqual(["bypass permissions  not allowed"]);
    expect(sent(daemon, "host.bypass")).toEqual([{ allow: false }]);
    const on = await flightdeckd(["host", "bypass", "on", "--confirm"], daemon.port);
    expect(on.out).toEqual(["bypass permissions  allowed"]);
    expect(sent(daemon, "host.bypass")[1]).toEqual({ allow: true, confirm: true });
  });

  test("bypass on without --confirm is the daemon's refusal: exit 1, its text, nothing sent but the one request", async () => {
    const daemon = fakeDaemon({
      "host.bypass": () => ({
        error: {
          code: "invalid_state",
          message: "allowing sessions without permission prompts needs confirm: true",
          reason: "bypass_confirm",
        },
      }),
    });
    const run = await flightdeckd(["host", "bypass", "on"], daemon.port);
    expect([run.code, run.out, run.err.join("\n")]).toEqual([
      1,
      [],
      expect.stringContaining("needs confirm: true"),
    ]);
    expect(sent(daemon, "host.bypass")).toEqual([{ allow: true }]);
  });

  test("a host with a device enrolled refuses bypass on: the person must use the app, and no proof is sent", async () => {
    const daemon = fakeDaemon({
      "host.bypass": () => ({
        error: {
          code: "invalid_state",
          message: "the signed proof of an enrolled device is needed",
          reason: "approval_proof_required",
        },
      }),
    });
    const run = await flightdeckd(["host", "bypass", "on", "--confirm"], daemon.port);
    expect([run.code, run.out]).toEqual([1, []]);
    expect(run.err.join("\n")).toContain("turn it on in the app");
    expect(sent(daemon, "host.bypass")).toEqual([{ allow: true, confirm: true }]);
  });

  test("a connection lost while a write is in flight says the switch may or may not have changed", async () => {
    const daemon = fakeDaemon({ "host.sleep": () => CLOSE });
    const run = await flightdeckd(["host", "sleep", "30"], daemon.port);
    expect(run.code).toBe(2);
    expect(run.err.join("\n")).toContain("may or may not");
  });

  test("a bare host still prints the facts, and no daemon is exit 2", async () => {
    const daemon = fakeDaemon({
      "host.info": () => ({
        hostName: "pi",
        os: "linux",
        arch: "arm64",
        daemonVersion: "1",
        claudeVersion: null,
        activeSessions: 0,
      }),
    });
    const { port } = daemon;
    const info = await flightdeckd(["host"], port);
    expect(info.out[0]).toBe("host  pi");
    await stopAll();
    expect((await flightdeckd(["host", "sleep", "30"], port)).code).toBe(2);
  });
});
