import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { parseArgs } from "../../src/main.ts";
import { runSshCli } from "../../src/ssh/index.ts";
import { CLOSE, config, fakeDaemon, type Handlers, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const NOW = "2026-11-20T09:00:00Z";
const target = (id: string, name: string, auth: string) => ({
  id,
  name,
  host: `${name}.internal`,
  port: 22,
  user: "deploy",
  viaHost: null,
  auth,
  secretRef: auth === "agent" ? null : "sec-1",
  jump: null,
  options: {},
  tags: [],
  hostKey: null,
  createdAt: NOW,
  updatedAt: NOW,
});
const TARGETS = [
  target("t1", "prod", "agent"),
  target("t2", "db", "vault-key"),
  target("t3", "twin", "agent"),
  target("t4", "twin", "agent"),
];

const PINNED = { status: "pinned", fingerprint: "SHA256:kept", pinned: "SHA256:kept" };
const UNKNOWN = { status: "unknown", fingerprint: "SHA256:new", pinned: null };
const CHANGED = { status: "changed", fingerprint: "SHA256:new", pinned: "SHA256:old" };

const OPEN: Handlers = {
  "ssh.list": () => ({ targets: TARGETS }),
  "ssh.hostkey.check": () => PINNED,
  "ssh.test": () => ({ ok: true, error: null }),
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

describe("flightdeckd ssh hostkey check (issue #3537)", () => {
  test("a pinned key is one line and exit 0; the daemon is asked about the id the name stands for", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["ssh", "hostkey", "check", "prod"], daemon.port);
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: ["prod: host key pinned, SHA256:kept"],
      err: [],
    });
    expect(callsOf(daemon, "ssh.hostkey.check")).toEqual([{ targetId: "t1" }]);
  });

  test("an id names the target too", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["ssh", "hostkey", "check", "t2"], daemon.port);
    expect(run.code).toBe(0);
    expect(callsOf(daemon, "ssh.hostkey.check")).toEqual([{ targetId: "t2" }]);
  });

  test("a key that is not pinned yet is exit 1 with the fingerprint the server shows", async () => {
    const daemon = fakeDaemon({ ...OPEN, "ssh.hostkey.check": () => UNKNOWN });
    const run = await flightdeckd(["ssh", "hostkey", "check", "prod"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({
      code: 1,
      out: ["prod: host key not pinned yet, the server shows SHA256:new"],
    });
  });

  test("a key that changed is exit 1 and shows both fingerprints", async () => {
    const daemon = fakeDaemon({ ...OPEN, "ssh.hostkey.check": () => CHANGED });
    const run = await flightdeckd(["ssh", "hostkey", "check", "prod"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({
      code: 1,
      out: ["prod: host key CHANGED, pinned SHA256:old, the server shows SHA256:new"],
    });
  });

  test("--json prints the check as the protocol returns it, and the exit code still tells the status", async () => {
    const daemon = fakeDaemon({ ...OPEN, "ssh.hostkey.check": () => CHANGED });
    const run = await flightdeckd(["ssh", "hostkey", "check", "prod", "--json"], daemon.port);
    expect(run.code).toBe(1);
    expect(printed(run.out)).toEqual(CHANGED);
    const ok = await flightdeckd(
      ["ssh", "hostkey", "check", "prod", "--json"],
      fakeDaemon(OPEN).port,
    );
    expect({ code: ok.code, body: printed(ok.out) }).toEqual({
      code: 0,
      body: PINNED,
    });
  });

  test("a name no target has is refused and the daemon is never asked to connect", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["ssh", "hostkey", "check", "nope"], daemon.port);
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 1,
      out: [],
      err: ["no such ssh target: nope"],
    });
    expect(callsOf(daemon, "ssh.hostkey.check")).toEqual([]);
  });

  test("a name two targets share is refused with their ids, never guessed", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["ssh", "hostkey", "check", "twin"], daemon.port);
    expect({ code: run.code, err: run.err }).toEqual({
      code: 1,
      err: ["2 ssh targets are named twin: use an id (t3, t4)"],
    });
    expect(callsOf(daemon, "ssh.hostkey.check")).toEqual([]);
  });
});

describe("flightdeckd ssh test (issue #3537)", () => {
  test("a reachable target is one line and exit 0, and the request carries the id and nothing else", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["ssh", "test", "prod"], daemon.port);
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: ["prod: reachable"],
      err: [],
    });
    expect(callsOf(daemon, "ssh.test")).toEqual([{ targetId: "t1" }]);
  });

  test("a failed test is exit 1 with the daemon's words, and --json keeps its reason and params", async () => {
    const failed = {
      ok: false,
      error: "the server refused the key",
      reason: "ssh_auth_failed",
      params: { user: "deploy" },
    };
    const daemon = fakeDaemon({ ...OPEN, "ssh.test": () => failed });
    const text = await flightdeckd(["ssh", "test", "prod"], daemon.port);
    expect({ code: text.code, out: text.out }).toEqual({
      code: 1,
      out: ["prod: failed, the server refused the key"],
    });
    const asJson = await flightdeckd(["ssh", "test", "prod", "--json"], daemon.port);
    expect(asJson.code).toBe(1);
    expect(printed(asJson.out)).toEqual(failed);
  });

  test("a target that needs a vault key is refused here: the terminal never sends a key, and nothing connects", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["ssh", "test", "db"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("db uses a vault key");
    expect(callsOf(daemon, "ssh.test")).toEqual([]);
  });

  test("a daemon refusal is one line on stderr, exit 1", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "ssh.test": () => ({ error: { code: "not_found", message: "destination not found" } }),
    });
    const run = await flightdeckd(["ssh", "test", "prod"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("destination not found");
  });

  test("a test that is never answered exits 2 and never says it may have changed something", async () => {
    const daemon = fakeDaemon({ ...OPEN, "ssh.test": () => undefined });
    const result = await runSshCli({ action: "test", target: "prod" }, config(daemon.port), {
      timeoutMs: 300,
    });
    expect(result.code).toBe(2);
    expect(result.err.join("\n")).not.toContain("may or may not");
  });

  test("a daemon that closes the connection is exit 2", async () => {
    const daemon = fakeDaemon({ ...OPEN, "ssh.hostkey.check": () => CLOSE });
    const run = await flightdeckd(["ssh", "hostkey", "check", "prod"], daemon.port);
    expect(run.code).toBe(2);
  });
});

describe("the arguments of ssh hostkey check and ssh test (issue #3537)", () => {
  const parsed = (argv: string[]) => {
    try {
      return parseArgs(argv);
    } catch (error) {
      return { refusedWith: (error as Error).message };
    }
  };

  test("each verb reads its target, --json and --host", () => {
    expect(parsed(["ssh", "hostkey", "check", "prod", "--json"])).toMatchObject({
      command: "ssh",
      action: "hostkey-check",
      sshTarget: "prod",
      json: true,
    });
    expect(parsed(["ssh", "test", "prod", "--host", "pi"])).toMatchObject({
      command: "ssh",
      action: "test",
      sshTarget: "prod",
      host: "pi",
    });
  });

  test("a missing target or a verb that is not read-only is refused before anything is sent", () => {
    expect(JSON.stringify(parsed(["ssh", "test"]))).toContain("missing the ssh target");
    expect(JSON.stringify(parsed(["ssh", "hostkey", "check"]))).toContain("missing the ssh target");
    expect(JSON.stringify(parsed(["ssh", "hostkey"]))).toContain("invalid ssh hostkey action");
    expect(JSON.stringify(parsed(["ssh", "hostkey", "forget", "prod"]))).toContain(
      "invalid ssh hostkey action",
    );
  });

  test("a second operand is refused, so a typo cannot pass", () => {
    expect(JSON.stringify(parsed(["ssh", "test", "prod", "db"]))).toContain("unknown argument: db");
  });
});
