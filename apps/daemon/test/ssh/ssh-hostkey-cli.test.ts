import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { parseArgs } from "../../src/main.ts";
import { runSshCli } from "../../src/ssh/index.ts";
import { CLOSE, config, fakeDaemon, type Handlers, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const NOW = "2026-11-20T09:00:00Z";
const target = (id: string, name: string, hostKey: string | null) => ({
  id,
  name,
  host: `${name}.internal`,
  port: 22,
  user: "deploy",
  viaHost: null,
  auth: "agent",
  secretRef: null,
  jump: null,
  options: {},
  tags: [],
  hostKey,
  createdAt: NOW,
  updatedAt: NOW,
});
const TARGETS = [
  target("t1", "prod", null),
  target("t2", "twin", null),
  target("t3", "twin", null),
];

const SHOWN = "SHA256:shown";
const UNKNOWN = { status: "unknown", fingerprint: SHOWN, pinned: null };
const PINNED = { status: "pinned", fingerprint: SHOWN, pinned: SHOWN };
const CHANGED = { status: "changed", fingerprint: SHOWN, pinned: "SHA256:old" };

const OPEN: Handlers = {
  "ssh.list": () => ({ targets: TARGETS }),
  "ssh.hostkey.check": () => UNKNOWN,
  "ssh.hostkey.confirm": () => target("t1", "prod", SHOWN),
  "ssh.hostkey.forget": () => target("t1", "prod", null),
};

/** The one JSON value a `--json` run printed, or null when it printed none. */
const printed = (out: string[]) => {
  try {
    return JSON.parse(out.join("\n")) as unknown;
  } catch {
    return null;
  }
};

const callsOf = (daemon: ReturnType<typeof fakeDaemon>, type: string) =>
  daemon.calls.filter((c) => c.type === type).map((c) => c.payload);

const confirm = (fingerprint: string, name = "prod", ...more: string[]) => [
  "ssh",
  "hostkey",
  "confirm",
  name,
  "--fingerprint",
  fingerprint,
  ...more,
];

describe("flightdeckd ssh hostkey confirm (issue #3537)", () => {
  test("the fingerprint the person typed is the one pinned, after a fresh check shows the same", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(confirm(SHOWN), daemon.port);
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: [`prod: host key pinned, ${SHOWN}`],
      err: [],
    });
    expect(callsOf(daemon, "ssh.hostkey.check")).toEqual([{ targetId: "t1" }]);
    expect(callsOf(daemon, "ssh.hostkey.confirm")).toEqual([
      { targetId: "t1", fingerprint: SHOWN },
    ]);
  });

  test("a fingerprint other than the one the server shows pins nothing: no confirm is sent", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(confirm("SHA256:typed"), daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("the server shows SHA256:shown, not SHA256:typed");
    expect(callsOf(daemon, "ssh.hostkey.confirm")).toEqual([]);
  });

  test("a key that changed is never pinned over: the person is pointed to forget it first", async () => {
    const daemon = fakeDaemon({ ...OPEN, "ssh.hostkey.check": () => CHANGED });
    const run = await flightdeckd(confirm(SHOWN), daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("ssh hostkey forget prod");
    expect(callsOf(daemon, "ssh.hostkey.confirm")).toEqual([]);
    expect(callsOf(daemon, "ssh.hostkey.forget")).toEqual([]);
  });

  test("a key that is already pinned and matches is exit 1 and sends no confirm", async () => {
    const daemon = fakeDaemon({ ...OPEN, "ssh.hostkey.check": () => PINNED });
    const run = await flightdeckd(confirm(SHOWN), daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("already pinned");
    expect(callsOf(daemon, "ssh.hostkey.confirm")).toEqual([]);
  });

  test("a refusal of the daemon is one line on stderr, exit 1", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "ssh.hostkey.confirm": () => ({
        error: { code: "invalid_state", message: "confirm the fingerprint that was just shown" },
      }),
    });
    const run = await flightdeckd(confirm(SHOWN), daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("confirm the fingerprint that was just shown");
  });

  test("--json prints the destination as the daemon returns it", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(confirm(SHOWN, "prod", "--json"), daemon.port);
    expect(run.code).toBe(0);
    expect(printed(run.out)).toMatchObject({ id: "t1", name: "prod", hostKey: SHOWN });
  });

  test("a name no destination has, or two share, asks the daemon for nothing", async () => {
    const daemon = fakeDaemon(OPEN);
    const none = await flightdeckd(confirm(SHOWN, "nope"), daemon.port);
    const two = await flightdeckd(confirm(SHOWN, "twin"), daemon.port);
    expect([none.code, none.err.join("")]).toEqual([1, "flightdeckd: no such ssh target: nope"]);
    expect([two.code, two.err.join("")]).toEqual([
      1,
      "flightdeckd: 2 ssh targets are named twin: use an id (t2, t3)",
    ]);
    expect(callsOf(daemon, "ssh.hostkey.check")).toEqual([]);
    expect(callsOf(daemon, "ssh.hostkey.confirm")).toEqual([]);
  });

  test("a check that is never answered is exit 2", async () => {
    const daemon = fakeDaemon({ ...OPEN, "ssh.hostkey.check": () => undefined });
    const result = await runSshCli(
      { action: "hostkey-confirm", target: "prod", fingerprint: SHOWN },
      config(daemon.port),
      { timeoutMs: 300 },
    );
    expect(result.code).toBe(2);
    expect(callsOf(daemon, "ssh.hostkey.confirm")).toEqual([]);
  });

  test("a daemon that closes the connection is exit 2", async () => {
    const daemon = fakeDaemon({ ...OPEN, "ssh.hostkey.confirm": () => CLOSE });
    const run = await flightdeckd(confirm(SHOWN), daemon.port);
    expect(run.code).toBe(2);
  });
});

describe("flightdeckd ssh hostkey forget (issue #3537)", () => {
  test("forgetting names the destination by id and says what it did", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["ssh", "hostkey", "forget", "prod"], daemon.port);
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: ["prod: pinned host key forgotten, the next check shows the server key again"],
      err: [],
    });
    expect(callsOf(daemon, "ssh.hostkey.forget")).toEqual([{ targetId: "t1" }]);
  });

  test("--json prints the destination as the daemon returns it", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["ssh", "hostkey", "forget", "prod", "--json"], daemon.port);
    expect(run.code).toBe(0);
    expect(printed(run.out)).toMatchObject({ id: "t1", hostKey: null });
  });

  test("an unknown name is refused and nothing is forgotten", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["ssh", "hostkey", "forget", "nope"], daemon.port);
    expect([run.code, run.err.join("")]).toEqual([1, "flightdeckd: no such ssh target: nope"]);
    expect(callsOf(daemon, "ssh.hostkey.forget")).toEqual([]);
  });

  test("a daemon refusal is one line on stderr, exit 1", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "ssh.hostkey.forget": () => ({
        error: { code: "not_found", message: "destination not found" },
      }),
    });
    const run = await flightdeckd(["ssh", "hostkey", "forget", "prod"], daemon.port);
    expect([run.code, run.out]).toEqual([1, []]);
    expect(run.err.join("\n")).toContain("destination not found");
  });
});

describe("the arguments of ssh hostkey confirm and forget (issue #3537)", () => {
  const parsed = (argv: string[]) => {
    try {
      return parseArgs(argv);
    } catch (error) {
      return { refusedWith: (error as Error).message };
    }
  };

  test("confirm reads its target and fingerprint, forget its target", () => {
    expect(parsed(confirm(SHOWN, "prod", "--host", "pi"))).toMatchObject({
      command: "ssh",
      action: "hostkey-confirm",
      sshTarget: "prod",
      sshFingerprint: SHOWN,
      host: "pi",
    });
    expect(parsed(["ssh", "hostkey", "forget", "prod", "--json"])).toMatchObject({
      command: "ssh",
      action: "hostkey-forget",
      sshTarget: "prod",
      json: true,
    });
  });

  test("confirm without a fingerprint, or with one that is not a SHA256 one, is refused before anything is sent", () => {
    expect(JSON.stringify(parsed(["ssh", "hostkey", "confirm", "prod"]))).toContain(
      "missing --fingerprint",
    );
    expect(JSON.stringify(parsed(confirm("not-a-fingerprint")))).toContain(
      "--fingerprint: a SHA256 fingerprint",
    );
  });

  test("a fingerprint on any other verb is refused, and so is a missing target", () => {
    expect(
      JSON.stringify(parsed(["ssh", "hostkey", "forget", "prod", "--fingerprint", SHOWN])),
    ).toContain("--fingerprint: this flag only applies to flightdeckd ssh hostkey confirm");
    expect(JSON.stringify(parsed(["ssh", "test", "prod", "--fingerprint", SHOWN]))).toContain(
      "--fingerprint: this flag only applies to flightdeckd ssh hostkey confirm",
    );
    expect(JSON.stringify(parsed(["ssh", "hostkey", "forget"]))).toContain(
      "missing the ssh target",
    );
  });
});
