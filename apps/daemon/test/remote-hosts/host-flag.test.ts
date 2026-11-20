import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { parseArgs } from "../../src/main.ts";
import { fakeDaemon, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";
import { machine, me, type Setup, TOKEN } from "./machine.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const HOST_INFO = {
  hostName: "orangepi",
  os: "linux",
  arch: "arm64",
  daemonVersion: "0.37.46",
  claudeVersion: "2.1.0",
  claudePath: "/home/dev/.local/bin/claude",
  uptimeSec: 3600,
  activeSessions: 2,
  apiKeySanitized: true,
  features: ["central"],
  allowBypassPermissions: true,
  logPath: "/home/dev/.flightdeck/flightdeckd.log",
};
const SESSION = {
  id: "s-1",
  name: "api",
  cwd: "/work/api",
  status: "idle",
  permissionMode: "default",
  model: "claude-sonnet-5-5",
  claudeSessionId: "claude-s-1",
  lastSeq: 7,
  createdAt: "2026-11-19T08:00:00.000Z",
  updatedAt: "2026-11-19T09:30:00.000Z",
};
const HANDLERS = {
  "host.info": () => HOST_INFO,
  "session.list": () => ({ sessions: [SESSION] }),
};

/** The command line of a paired host whose daemon is `daemon`; this machine's own config points nowhere. */
async function onHost(argv: string[], setup: Setup, daemon: { port: number } | null = null) {
  const url = daemon ? `ws://127.0.0.1:${daemon.port}/v1/ws` : "ws://127.0.0.1:9/v1/ws";
  const m = machine({ url, ...setup });
  const run = await flightdeckd(
    argv,
    1,
    JSON.stringify({ token: "local-config-token-not-the-hosts", port: 1 }),
    { remote: m.deps },
  );
  return { run, text: [...run.out, ...run.err].join("\n") };
}

describe("--host on the command line (#3429)", () => {
  test("it is accepted on host and sessions only, and needs a name", () => {
    expect(parseArgs(["host", "--host", "server"])).toMatchObject({
      command: "host",
      host: "server",
    });
    expect(parseArgs(["sessions", "--host=server", "--json"])).toMatchObject({ host: "server" });
    for (const argv of [
      ["approve", "r-1", "--host", "server"],
      ["doctor", "--host", "server"],
      ["start", "--host", "server"],
    ])
      expect(() => parseArgs(argv)).toThrow(
        "--host: this flag only applies to flightdeckd host and sessions",
      );
    expect(() => parseArgs(["host", "--host"])).toThrow("--host needs a value");
  });
});

describe.skipIf(me === null)(
  "--host runs a command on a paired host with its token (#3429)",
  () => {
    test("host --json answers from the host, not from this machine's config", async () => {
      const daemon = fakeDaemon(HANDLERS, TOKEN);
      const { run } = await onHost(["host", "--host", "server", "--json"], {}, daemon);
      expect(run.code).toBe(0);
      expect(JSON.parse(run.out.join("\n"))).toMatchObject({
        hostName: "orangepi",
        activeSessions: 2,
      });
    });

    test("sessions lists the sessions of that host", async () => {
      const daemon = fakeDaemon(HANDLERS, TOKEN);
      const { run } = await onHost(["sessions", "--host", "server", "--json"], {}, daemon);
      expect(run.code).toBe(0);
      expect(JSON.parse(run.out.join("\n"))).toMatchObject([{ id: "s-1", name: "api" }]);
    });

    test("this machine's config is not read: no daemon config is needed to ask another host", async () => {
      const daemon = fakeDaemon(HANDLERS, TOKEN);
      const m = machine({ url: `ws://127.0.0.1:${daemon.port}/v1/ws` });
      const run = await flightdeckd(["host", "--host", "server", "--json"], 1, "not json at all", {
        remote: m.deps,
      });
      expect(run.code).toBe(0);
    });

    test("--token is refused here too: the token comes from the credential store only", async () => {
      const { run } = await onHost(["host", "--host", "server", "--token", "abc"], {});
      expect(run.code).toBe(1);
      expect(run.err.join(" ")).toContain("read from the config file only");
    });

    test("--config is refused here: the config of this machine plays no part with --host", async () => {
      const { run } = await onHost(["host", "--host", "server", "--config", "/etc/other.json"], {});
      expect({ code: run.code, err: run.err.join(" ") }).toEqual({
        code: 1,
        err: expect.stringContaining("--config"),
      });
    });

    test("an unknown name is exit 1: plain text, or one JSON line with its reason under --json", async () => {
      const plain = await onHost(["host", "--host", "nope"], {});
      expect({ code: plain.run.code, err: plain.run.err }).toEqual({
        code: 1,
        err: [expect.stringContaining('flightdeckd: no host is named "nope"; known hosts: server')],
      });
      const asJson = await onHost(["host", "--host", "nope", "--json"], {});
      expect(asJson.run.code).toBe(1);
      expect(JSON.parse(asJson.run.err.join("\n"))).toEqual({
        error: expect.stringContaining('no host is named "nope"'),
        reason: "unknown_host",
      });
    });

    test("a revoked token is exit 1 with `pair this host again`, and the daemon's echo of the token is hidden", async () => {
      const daemon = fakeDaemon(HANDLERS, "the-daemon-wants-another-token");
      const { run, text } = await onHost(["host", "--host", "server", "--json"], {}, daemon);
      expect(run.code).toBe(1);
      expect(text).toContain("pair this host again in the app");
      expect(JSON.parse(run.err.join("\n"))).toMatchObject({ reason: "token_refused" });
      expect(text).not.toContain(TOKEN);
    });

    test("a host that does not answer is exit 2, with its reason", async () => {
      const { run, text } = await onHost(["host", "--host", "server", "--json"], {});
      expect(run.code).toBe(2);
      expect(JSON.parse(run.err.join("\n"))).toMatchObject({ reason: "unreachable" });
      expect(text).not.toContain(TOKEN);
    });

    test("no credential store is exit 1", async () => {
      const { run } = await onHost(["sessions", "--host", "server"], { helper: false });
      expect({ code: run.code, err: run.err.join(" ") }).toEqual({
        code: 1,
        err: expect.stringContaining("no credential store: pair from the app"),
      });
    });

    test("the token is in no output of any path: success, refused, unreachable, unknown, no store, cleartext", async () => {
      const good = fakeDaemon(HANDLERS, TOKEN);
      const cases: Array<[string[], Setup, { port: number } | null]> = [
        [["host", "--host", "server"], {}, good],
        [["host", "--host", "server", "--json"], {}, fakeDaemon(HANDLERS, "another")],
        [["sessions", "--host", "server"], {}, null],
        [["sessions", "--host", "nope", "--json"], {}, null],
        [["host", "--host", "server"], { helper: false }, null],
        [["host", "--host", "server", "--json"], { url: "ws://server.example.com/v1/ws" }, null],
      ];
      for (const [argv, setup, daemon] of cases) {
        const { text } = await onHost(argv, setup, daemon);
        expect({ argv, leaked: text.includes(TOKEN) }).toEqual({ argv, leaked: false });
      }
    });
  },
);
