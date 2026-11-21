import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { parseArgs } from "../../src/main.ts";
import { runRunenvCli } from "../../src/runenv/index.ts";
import {
  CLOSE,
  config,
  fakeDaemon,
  type Handlers,
  project,
  stopAll,
} from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const TRUSTED = {
  exists: true,
  hash: "9f3a1c",
  trusted: true,
  errors: [],
  config: { exclusive: false, setup: null, run: [], ports: [] },
};

const RUNNING = {
  cardId: "c1",
  status: "running",
  setup: "done",
  setupTerminalId: null,
  ports: {},
  processes: [],
  error: null,
};

const OPEN: Handlers = {
  "project.list": () => ({
    projects: [project("p1", "api"), project("p2", "web"), project("p3", "web")],
    maxParallelRuns: 2,
  }),
  "runenv.trust": () => TRUSTED,
  "runenv.start": () => RUNNING,
  "runenv.stop": () => ({ ...RUNNING, status: "stopped" }),
};

const callsOf = (daemon: ReturnType<typeof fakeDaemon>, type: string) =>
  daemon.calls.filter((c) => c.type === type).map((c) => c.payload);

const printed = (out: string[]) => {
  try {
    return JSON.parse(out.join("\n")) as unknown;
  } catch {
    return null;
  }
};

const parsed = (argv: string[]) => {
  try {
    return parseArgs(argv);
  } catch (error) {
    return { refusedWith: (error as Error).message };
  }
};

const refused = (argv: string[]): string => {
  try {
    parseArgs(argv);
    return "";
  } catch (error) {
    return (error as Error).message;
  }
};

describe("flightdeckd runenv trust (issue #3621)", () => {
  test("--hash names the file the person reviewed; the project is looked up first and the answer is its run.yaml", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(
      ["runenv", "trust", "api", "--hash", "9f3a1c", "--confirm"],
      daemon.port,
    );
    expect({ code: run.code, err: run.err }).toEqual({ code: 0, err: [] });
    expect(run.out[0]).toBe("api: run.yaml, hash 9f3a1c, trusted");
    expect(callsOf(daemon, "runenv.trust")).toEqual([{ projectId: "p1", hash: "9f3a1c" }]);
  });

  test("--json prints the file the daemon answers with", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(
      ["runenv", "trust", "p1", "--hash", "9f3a1c", "--confirm", "--json"],
      daemon.port,
    );
    expect(printed(run.out)).toMatchObject({ exists: true, trusted: true });
  });

  test("a name two projects share is refused, and nothing is trusted", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(
      ["runenv", "trust", "web", "--hash", "9f3a1c", "--confirm"],
      daemon.port,
    );
    expect(run.code).toBe(1);
    expect(callsOf(daemon, "runenv.trust")).toEqual([]);
  });

  test("a file that changed since the person read it is exit 1 with the daemon's line", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "runenv.trust": () => ({
        error: {
          code: "invalid_state",
          message: "the run.yaml changed; review the commands again before trusting it",
        },
      }),
    });
    const run = await flightdeckd(
      ["runenv", "trust", "api", "--hash", "old", "--confirm"],
      daemon.port,
    );
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("the run.yaml changed");
  });

  test("a daemon that dies after the trust was sent: exit 2, and it may or may not have gone in", async () => {
    const daemon = fakeDaemon({ ...OPEN, "runenv.trust": () => CLOSE });
    const run = await flightdeckd(
      ["runenv", "trust", "api", "--hash", "9f3a1c", "--confirm"],
      daemon.port,
    );
    expect(run.code).toBe(2);
    expect(run.err.join("\n")).toContain("may or may not have been");
    expect(run.err.join("\n")).toContain("runenv config");
  });
});

describe("flightdeckd runenv start and stop (issue #3621)", () => {
  test("start runs the card's setup and processes and prints its state", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["runenv", "start", "c1", "--confirm"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({
      code: 0,
      out: ["c1: running, setup done"],
    });
    expect(callsOf(daemon, "runenv.start")).toEqual([{ cardId: "c1" }]);
  });

  test("stop needs no confirmation and prints the state it leaves", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["runenv", "stop", "c1", "--json"], daemon.port);
    expect(printed(run.out)).toMatchObject({ cardId: "c1", status: "stopped" });
    expect(callsOf(daemon, "runenv.stop")).toEqual([{ cardId: "c1" }]);
  });

  test("a card the daemon refuses is exit 1, and a silent daemon leaves a start or a stop unknown", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "runenv.start": () => ({ error: { code: "not_found", message: "card not found" } }),
    });
    const run = await flightdeckd(["runenv", "start", "nope", "--confirm"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("card not found");

    for (const args of [
      { action: "start", target: "c1" },
      { action: "stop", target: "c1" },
    ] as const) {
      const silent = fakeDaemon({});
      const result = await runRunenvCli(args, config(silent.port), { timeoutMs: 200 });
      expect(result.code).toBe(2);
      expect(result.err.join("\n")).toContain("may or may not have been");
      expect(result.err.join("\n")).toContain("runenv get");
    }
  });
});

describe("the flags of the runenv write verbs (issue #3621)", () => {
  test("trust and start refuse to run without --confirm, and trust without --hash", () => {
    expect(refused(["runenv", "trust", "api", "--hash", "9f3a1c"])).toContain(
      "runenv trust lets the project's run.yaml run: pass --confirm",
    );
    expect(refused(["runenv", "start", "c1"])).toContain(
      "runenv start runs the commands of the project's run.yaml: pass --confirm",
    );
    expect(refused(["runenv", "trust", "api", "--confirm"])).toContain("missing --hash");
  });

  test("a flag stays with its verb", () => {
    expect(refused(["runenv", "stop", "c1", "--confirm"])).toContain(
      "--confirm: this flag only applies to flightdeckd runenv trust or start",
    );
    expect(refused(["runenv", "start", "c1", "--confirm", "--hash", "x"])).toContain(
      "--hash: this flag only applies to flightdeckd runenv trust",
    );
    expect(refused(["runenv", "get", "c1", "--confirm"])).toContain(
      "--confirm: this flag only applies to flightdeckd runenv trust or start",
    );
    expect(refused(["card", "list", "--hash", "x"])).toContain("--hash");
  });

  test("the words parse into the target, the hash and the confirmation", () => {
    expect(parsed(["runenv", "trust", "api", "--hash", "9f3a1c", "--confirm"])).toMatchObject({
      command: "runenv",
      action: "trust",
      runenvTarget: "api",
      hash: "9f3a1c",
      confirm: true,
    });
    expect(parsed(["runenv", "stop", "c1"])).toMatchObject({
      command: "runenv",
      action: "stop",
      runenvTarget: "c1",
    });
  });
});
