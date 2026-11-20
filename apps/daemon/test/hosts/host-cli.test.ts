import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { fakeDaemon, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const hostInfo = (over: Record<string, unknown> = {}) => ({
  hostName: "orangepi",
  os: "linux",
  arch: "arm64",
  daemonVersion: "0.37.46",
  claudeVersion: "2.1.0",
  claudePath: "/home/dev/.local/bin/claude",
  uptimeSec: 3600,
  activeSessions: 2,
  apiKeySanitized: true,
  features: ["central", "workflows"],
  allowBypassPermissions: true,
  logPath: "/home/dev/.flightdeck/flightdeckd.log",
  ...over,
});

describe("flightdeckd host (issue #3424)", () => {
  test("--json prints one object with the version, the system, the features and the bypass switch", async () => {
    const daemon = fakeDaemon({ "host.info": () => hostInfo() });
    const run = await flightdeckd(["host", "--json"], daemon.port);
    expect(run.code).toBe(0);
    expect(run.err).toEqual([]);
    expect(run.out).toHaveLength(1);
    expect(JSON.parse(run.out.join("\n"))).toEqual({
      hostName: "orangepi",
      os: "linux",
      arch: "arm64",
      daemonVersion: "0.37.46",
      claudeVersion: "2.1.0",
      activeSessions: 2,
      features: ["central", "workflows"],
      allowBypassPermissions: true,
    });
  });

  test("a daemon that does not say a field gives null (or no features) and not a missing key", async () => {
    const daemon = fakeDaemon({
      "host.info": () =>
        hostInfo({ claudeVersion: null, features: undefined, allowBypassPermissions: undefined }),
    });
    const run = await flightdeckd(["host", "--json"], daemon.port);
    expect(run.out).toHaveLength(1);
    expect(JSON.parse(run.out.join("\n"))).toMatchObject({
      claudeVersion: null,
      features: [],
      allowBypassPermissions: null,
    });
  });

  test("without --json it prints one line per fact", async () => {
    const daemon = fakeDaemon({ "host.info": () => hostInfo() });
    const run = await flightdeckd(["host"], daemon.port);
    expect(run.code).toBe(0);
    expect(run.out).toEqual([
      "host  orangepi",
      "daemon  0.37.46",
      "system  linux arm64",
      "claude  2.1.0",
      "sessions  2 active",
      "features  central, workflows",
      "bypass permissions  allowed",
    ]);
  });

  test("no daemon at the address of the config: a line on stderr and exit 2", async () => {
    const daemon = fakeDaemon({});
    const port = daemon.port;
    await stopAll();
    const run = await flightdeckd(["host"], port);
    expect(run.code).toBe(2);
    expect(run.out).toEqual([]);
    expect(run.err.join("\n")).toContain("could not reach the daemon");
  });

  test("--token is refused with exit 1 and nothing is sent to the daemon", async () => {
    const daemon = fakeDaemon({ "host.info": () => hostInfo() });
    const run = await flightdeckd(["host", "--token", "x"], daemon.port);
    expect(run.code).toBe(1);
    expect(run.err.join("\n")).toContain("read from the config file only");
    expect(daemon.calls).toEqual([]);
  });

  test("--description is not a flag of host", async () => {
    const run = await flightdeckd(["host", "--description", "x"], 1);
    expect(run.code).toBe(1);
    expect(run.err.join("\n")).toContain("only applies to flightdeckd card");
  });

  test("a config that is not valid JSON is refused without printing what it holds", async () => {
    const secret = "abcdefghijklmnopqrstuvwxyz0123456789";
    const run = await flightdeckd(["host"], 1, `{"token": ${secret}}`);
    expect(run.code).toBe(1);
    expect(run.err.join("\n")).not.toContain(secret);
    expect(run.err.join("\n")).toContain("config file");
  });
});
