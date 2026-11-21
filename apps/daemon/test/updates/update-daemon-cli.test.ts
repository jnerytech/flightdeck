import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { parseArgs } from "../../src/main.ts";
import { CLOSE, fakeDaemon, type Handlers, stopAll } from "../board/card-cli-helpers.ts";
import { type CliRun, flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const AT = "2026-11-21T10:00:00.000Z";

const base = (over: Handlers = {}): Handlers => ({
  "daemon.update.check": () => ({ available: true, version: "0.39.0", checkedAt: AT }),
  "daemon.update.apply": () => ({ started: true }),
  // The real daemon answers with no value; a fake that returns nothing never answers.
  "daemon.shutdown": () => null,
  ...over,
});

const sent = (daemon: ReturnType<typeof fakeDaemon>, type: string) =>
  daemon.calls.filter((c) => c.type === type).map((c) => c.payload);

/** The one JSON value a command printed; what it printed instead when that is not JSON, so a miss is an assertion. */
const jsonOf = (run: CliRun): unknown => {
  try {
    return JSON.parse(run.out.join("\n"));
  } catch {
    return { printed: run.out, err: run.err };
  }
};

const parsed = (argv: string[]): Record<string, unknown> => {
  try {
    return { ...parseArgs(argv) };
  } catch (error) {
    return { refusal: String((error as Error).message).split("\n")[0] };
  }
};

describe("the update and daemon arguments (issue #3780)", () => {
  test("update takes check or apply, and with neither it is the install of a local file", () => {
    expect(parsed(["update", "check"])).toMatchObject({ command: "update", action: "check" });
    expect(parsed(["update", "check", "--json"])).toMatchObject({ action: "check", json: true });
    expect(parsed(["update", "apply", "--confirm"])).toMatchObject({
      command: "update",
      action: "apply",
      confirm: true,
    });
    const file = parsed(["update", "--from", "./flightdeckd-new", "--allow-downgrade"]);
    expect(file).toMatchObject({ command: "update", from: "./flightdeckd-new" });
    expect(file).not.toHaveProperty("action");
    expect(parsed(["update", "bogus"])).toHaveProperty("refusal");
  });

  test("daemon takes stop alone", () => {
    expect(parsed(["daemon", "stop", "--confirm"])).toMatchObject({
      command: "daemon",
      action: "stop",
      confirm: true,
    });
    expect(parsed(["daemon", "stop", "--confirm", "--json"])).toMatchObject({ json: true });
    for (const line of [["daemon"], ["daemon", "start", "--confirm"], ["daemon", "restart"]]) {
      expect(parsed(line)).toHaveProperty("refusal");
    }
  });

  test("apply and stop need --confirm, and nothing else takes it", () => {
    expect(parsed(["update", "apply"])).toEqual({ refusal: "update apply needs --confirm" });
    expect(parsed(["daemon", "stop"])).toEqual({ refusal: "daemon stop needs --confirm" });
    expect(parsed(["update", "check", "--confirm"])).toHaveProperty(
      "refusal",
      expect.stringContaining("--confirm"),
    );
    expect(parsed(["update", "--from", "./f", "--confirm"])).toHaveProperty(
      "refusal",
      expect.stringContaining("--confirm"),
    );
  });

  test("the install of a file keeps its own flags, and the daemon verbs refuse them", () => {
    for (const line of [
      ["update", "check", "--from", "./f"],
      ["update", "apply", "--confirm", "--from", "./f"],
      ["update", "check", "--allow-downgrade"],
    ]) {
      expect(parsed(line)).toHaveProperty("refusal");
    }
    // No JSON for the install of a file: the flag is refused, not ignored.
    expect(parsed(["update", "--from", "./f", "--json"])).toHaveProperty(
      "refusal",
      expect.stringContaining("--json"),
    );
  });

  test("they ask this machine's daemon only: --host is refused", () => {
    for (const line of [
      ["update", "check", "--host", "pi"],
      ["update", "apply", "--confirm", "--host", "pi"],
      ["daemon", "stop", "--confirm", "--host", "pi"],
    ]) {
      expect(parsed(line)).toHaveProperty("refusal", expect.stringContaining("--host"));
    }
  });
});

describe("flightdeckd update check (issue #3780)", () => {
  test("it prints the update the daemon found, the way the app shows it", async () => {
    const daemon = fakeDaemon(base());
    const run = await flightdeckd(["update", "check"], daemon.port);
    expect({ code: run.code, err: run.err, out: run.out }).toEqual({
      code: 0,
      err: [],
      out: [`available  0.39.0  checked ${AT}`],
    });
    expect(sent(daemon, "daemon.update.check")).toEqual([{}]);
  });

  test("no update is exit 0, and a check that failed prints its error and exits 0", async () => {
    const none = fakeDaemon(
      base({
        "daemon.update.check": () => ({ available: false, version: null, checkedAt: AT }),
      }),
    );
    const noneRun = await flightdeckd(["update", "check"], none.port);
    expect({ code: noneRun.code, out: noneRun.out }).toEqual({
      code: 0,
      out: [`up to date  checked ${AT}`],
    });
    const failed = fakeDaemon(
      base({
        "daemon.update.check": () => ({
          available: false,
          version: null,
          checkedAt: AT,
          error: "the release server did not answer",
        }),
      }),
    );
    const failedRun = await flightdeckd(["update", "check"], failed.port);
    expect({ code: failedRun.code, out: failedRun.out }).toEqual({
      code: 0,
      out: [`check failed  the release server did not answer  checked ${AT}`],
    });
  });

  test("--json prints the four keys, with null for what is missing", async () => {
    const daemon = fakeDaemon(base());
    const run = await flightdeckd(["update", "check", "--json"], daemon.port);
    expect(jsonOf(run)).toEqual({
      available: true,
      version: "0.39.0",
      checkedAt: AT,
      error: null,
    });
  });

  test("a daemon that refuses exits 1 with its text, and no daemon is exit 2", async () => {
    const daemon = fakeDaemon({
      "daemon.update.check": () => ({ error: { code: "feature_off", message: "updates are off" } }),
    });
    const refused = await flightdeckd(["update", "check"], daemon.port);
    expect([refused.code, refused.err.join("\n")]).toEqual([
      1,
      expect.stringContaining("updates are off"),
    ]);
    const { port } = daemon;
    await stopAll();
    expect((await flightdeckd(["update", "check"], port)).code).toBe(2);
  });
});

describe("flightdeckd update apply (issue #3780)", () => {
  test("with --confirm it sends the confirm and says the update started", async () => {
    const daemon = fakeDaemon(base());
    const run = await flightdeckd(["update", "apply", "--confirm"], daemon.port);
    expect({ code: run.code, err: run.err, out: run.out }).toEqual({
      code: 0,
      err: [],
      out: ["update started"],
    });
    expect(sent(daemon, "daemon.update.apply")).toEqual([{ confirm: true }]);
    const json = await flightdeckd(["update", "apply", "--confirm", "--json"], daemon.port);
    expect(jsonOf(json)).toEqual({ started: true });
  });

  test("without --confirm it exits 1 and the daemon hears nothing", async () => {
    const daemon = fakeDaemon(base());
    const run = await flightdeckd(["update", "apply"], daemon.port);
    expect([run.code, run.err.join("\n")]).toEqual([1, expect.stringContaining("--confirm")]);
    expect(daemon.calls.filter((c) => c.type.startsWith("daemon."))).toEqual([]);
  });

  test("a refusal exits 1 with the daemon's text, no daemon is 2, and a lost connection says it may or may not have started", async () => {
    const refusing = fakeDaemon({
      "daemon.update.apply": () => ({
        error: { code: "invalid_state", message: "no update has been checked" },
      }),
    });
    const refused = await flightdeckd(["update", "apply", "--confirm"], refusing.port);
    expect([refused.code, refused.err.join("\n")]).toEqual([
      1,
      expect.stringContaining("no update has been checked"),
    ]);
    const closing = fakeDaemon({ "daemon.update.apply": () => CLOSE });
    const lost = await flightdeckd(["update", "apply", "--confirm"], closing.port);
    expect(lost.code).toBe(2);
    expect(lost.err.join("\n")).toContain("may or may not");
    const { port } = closing;
    await stopAll();
    expect((await flightdeckd(["update", "apply", "--confirm"], port)).code).toBe(2);
  });
});

describe("flightdeckd daemon stop (issue #3780)", () => {
  test("with --confirm it sends the confirm and says it is stopping, on the ack", async () => {
    const daemon = fakeDaemon(base());
    const run = await flightdeckd(["daemon", "stop", "--confirm"], daemon.port);
    expect({ code: run.code, err: run.err, out: run.out }).toEqual({
      code: 0,
      err: [],
      out: ["stopping"],
    });
    expect(sent(daemon, "daemon.shutdown")).toEqual([{ confirm: true }]);
    const json = await flightdeckd(["daemon", "stop", "--confirm", "--json"], daemon.port);
    expect(jsonOf(json)).toEqual({ stopping: true });
  });

  test("without --confirm it exits 1 and the daemon hears nothing", async () => {
    const daemon = fakeDaemon(base());
    const run = await flightdeckd(["daemon", "stop"], daemon.port);
    expect([run.code, run.err.join("\n")]).toEqual([1, expect.stringContaining("--confirm")]);
    expect(sent(daemon, "daemon.shutdown")).toEqual([]);
  });

  test("a refusal exits 1 with the daemon's text, no daemon is 2, and a lost connection says it may or may not have stopped", async () => {
    const refusing = fakeDaemon({
      "daemon.shutdown": () => ({ error: { code: "feature_off", message: "shutdown is off" } }),
    });
    const refused = await flightdeckd(["daemon", "stop", "--confirm"], refusing.port);
    expect([refused.code, refused.err.join("\n")]).toEqual([
      1,
      expect.stringContaining("shutdown is off"),
    ]);
    const closing = fakeDaemon({ "daemon.shutdown": () => CLOSE });
    const lost = await flightdeckd(["daemon", "stop", "--confirm"], closing.port);
    expect(lost.code).toBe(2);
    expect(lost.err.join("\n")).toContain("may or may not");
    const { port } = closing;
    await stopAll();
    expect((await flightdeckd(["daemon", "stop", "--confirm"], port)).code).toBe(2);
  });
});
