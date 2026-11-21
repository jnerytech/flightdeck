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
import { watchedCli } from "../support/cli-watch.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const CONFIG_INFO = {
  exists: true,
  hash: "9f3a1c",
  trusted: true,
  errors: [],
  config: {
    exclusive: true,
    setup: ["bun install", "bun run db:migrate"],
    run: [
      {
        name: "web",
        cmd: ["bun", "run", "dev"],
        env: { PORT: "{web}", SECRET_HINT: "x" },
        ready: { http: "http://127.0.0.1:{web}/" },
      },
      { name: "worker", cmd: ["bun", "run", "jobs"], env: {}, ready: null },
    ],
    ports: ["web", "api"],
  },
};

const STATE = {
  cardId: "c1",
  status: "running",
  setup: "done",
  setupTerminalId: "t0",
  ports: { web: 4101, api: 4102 },
  processes: [
    {
      name: "web",
      terminalId: "t1",
      status: "running",
      exitCode: null,
      url: "http://127.0.0.1:4101",
      ready: "ready",
    },
    {
      name: "worker",
      terminalId: "t2",
      status: "exited",
      exitCode: 1,
      url: null,
      ready: "none",
    },
  ],
  error: null,
};

const OPEN: Handlers = {
  "project.list": () => ({
    projects: [project("p1", "api"), project("p2", "web"), project("p3", "web")],
    maxParallelRuns: 2,
  }),
  "runenv.config": () => CONFIG_INFO,
  "runenv.get": () => STATE,
};

const printed = (out: string[]) => {
  try {
    return JSON.parse(out.join("\n")) as unknown;
  } catch {
    return null;
  }
};

const callsOf = (daemon: ReturnType<typeof fakeDaemon>, type: string) =>
  daemon.calls.filter((c) => c.type === type).map((c) => c.payload);

describe("flightdeckd runenv config (issue #3621)", () => {
  test("a project's run.yaml: the hash a person trusts, the ports, the setup and each process", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["runenv", "config", "api"], daemon.port);
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: [
        "api: run.yaml, hash 9f3a1c, trusted",
        "exclusive: yes",
        "ports: web, api",
        "setup:",
        "  bun install",
        "  bun run db:migrate",
        "processes:",
        "  web: bun run dev, ready http://127.0.0.1:{web}/, env PORT, SECRET_HINT",
        "  worker: bun run jobs",
      ],
      err: [],
    });
    expect(callsOf(daemon, "runenv.config")).toEqual([{ projectId: "p1" }]);
  });

  test("a file that changed since it was trusted says so, and each error is a line", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "runenv.config": () => ({
        ...CONFIG_INFO,
        trusted: false,
        errors: ["run[1].cmd: empty"],
        config: null,
      }),
    });
    const run = await flightdeckd(["runenv", "config", "p1"], daemon.port);
    expect(run.out).toEqual([
      "api: run.yaml, hash 9f3a1c, not trusted",
      "error: run[1].cmd: empty",
    ]);
  });

  test("a project with no run.yaml says so and exits 0", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "runenv.config": () => ({
        exists: false,
        hash: null,
        trusted: false,
        errors: [],
        config: null,
      }),
    });
    const run = await flightdeckd(["runenv", "config", "api"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 0, out: ["api: no run.yaml"] });
  });

  test("--json prints every key, null where there is no file", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "runenv.config": () => ({ exists: false, hash: null, trusted: false, errors: [] }),
    });
    const run = await flightdeckd(["runenv", "config", "api", "--json"], daemon.port);
    expect(run.code).toBe(0);
    expect(printed(run.out)).toEqual({
      exists: false,
      hash: null,
      trusted: false,
      errors: [],
      config: null,
    });
  });

  test("a project name two projects share is refused with exit 1 and asks nothing of the run", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["runenv", "config", "web"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(callsOf(daemon, "runenv.config")).toEqual([]);
  });
});

describe("flightdeckd runenv get (issue #3621)", () => {
  test("a card's run: its state, its ports and one line a process with the terminal it runs in", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["runenv", "get", "c1"], daemon.port);
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: [
        "c1: running, setup done",
        "ports: web 4101, api 4102",
        "  web (t1): running, ready, http://127.0.0.1:4101",
        "  worker (t2): exited with code 1, no ready check",
      ],
      err: [],
    });
    expect(callsOf(daemon, "runenv.get")).toEqual([{ cardId: "c1" }]);
  });

  test("a card that failed says why; an idle card has no ports and no processes", async () => {
    const failed = fakeDaemon({
      ...OPEN,
      "runenv.get": () => ({ ...STATE, status: "failed", setup: "failed", error: "setup failed" }),
    });
    const idle = fakeDaemon({
      ...OPEN,
      "runenv.get": () => ({
        cardId: "c1",
        status: "idle",
        setup: "pending",
        setupTerminalId: null,
        ports: {},
        processes: [],
        error: null,
      }),
    });
    expect((await flightdeckd(["runenv", "get", "c1"], failed.port)).out.at(-1)).toBe(
      "error: setup failed",
    );
    expect((await flightdeckd(["runenv", "get", "c1"], idle.port)).out).toEqual([
      "c1: idle, setup pending",
    ]);
  });

  test("--json prints every key, null where an older daemon sends none", async () => {
    const older = {
      cardId: "c1",
      status: "running",
      setup: "done",
      ports: {},
      processes: [{ name: "web", terminalId: "t1", status: "running", ready: "waiting" }],
    };
    const daemon = fakeDaemon({ ...OPEN, "runenv.get": () => older });
    const run = await flightdeckd(["runenv", "get", "c1", "--json"], daemon.port);
    expect(run.code).toBe(0);
    expect(printed(run.out)).toEqual({
      cardId: "c1",
      status: "running",
      setup: "done",
      setupTerminalId: null,
      ports: {},
      processes: [
        {
          name: "web",
          terminalId: "t1",
          status: "running",
          exitCode: null,
          url: null,
          ready: "waiting",
        },
      ],
      error: null,
    });
  });

  test("a card the daemon does not know is one line on stderr and exit 1; a closed connection is exit 2", async () => {
    const unknown = fakeDaemon({
      ...OPEN,
      "runenv.get": () => ({ error: { code: "not_found", message: "card not found" } }),
    });
    const gone = fakeDaemon({ ...OPEN, "runenv.get": () => CLOSE });
    const refused = await flightdeckd(["runenv", "get", "nope"], unknown.port);
    expect({ code: refused.code, out: refused.out }).toEqual({ code: 1, out: [] });
    expect(refused.err.join("\n")).toContain("card not found");
    expect((await flightdeckd(["runenv", "get", "c1"], gone.port)).code).toBe(2);
  });

  test("text from the daemon cannot drive the terminal", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "runenv.get": () => ({ ...STATE, error: "\u001b[2Jwiped" }),
    });
    const run = await flightdeckd(["runenv", "get", "c1"], daemon.port);
    expect(run.out.join("\n")).toContain("wiped");
    expect(run.out.join("\n").includes("\u001b")).toBe(false);
  });
});

const watching = (
  daemon: ReturnType<typeof fakeDaemon>,
  options: Parameters<typeof watchedCli>[3] & { json?: boolean },
) =>
  watchedCli(
    daemon,
    "runenv.watch",
    (cfg, run) =>
      runRunenvCli({ action: "watch", ...(options.json ? { json: true } : {}) }, cfg, run),
    options,
  );

describe("flightdeckd runenv watch (issue #3621)", () => {
  test("it writes the run of each card the daemon pushes, and Ctrl-C ends it with 0", async () => {
    const daemon = fakeDaemon({ "runenv.watch": () => ({}) });
    const { result, lines } = await watching(daemon, {
      lines: 2,
      after: () => {
        daemon.push({ type: "runenv.updated", state: STATE });
        daemon.push({
          type: "runenv.updated",
          state: { ...STATE, cardId: "c2", status: "setup", setup: "running", processes: [] },
        });
      },
    });
    // One line an update: the stream flattens a line break.
    expect(lines).toEqual([
      "c1: running, setup done; ports: web 4101, api 4102; web (t1): running, ready, http://127.0.0.1:4101; worker (t2): exited with code 1, no ready check",
      "c2: setup, setup running; ports: web 4101, api 4102",
    ]);
    expect(result.code).toBe(0);
    expect(callsOf(daemon, "runenv.watch")).toEqual([{}]);
  });

  test("--json writes one run per line, every key kept", async () => {
    const daemon = fakeDaemon({ "runenv.watch": () => ({}) });
    const { lines } = await watching(daemon, {
      json: true,
      after: () =>
        daemon.push({
          type: "runenv.updated",
          state: {
            cardId: "c1",
            status: "idle",
            setup: "pending",
            setupTerminalId: null,
            ports: {},
            processes: [],
            error: null,
          },
        }),
    });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toEqual({
      cardId: "c1",
      status: "idle",
      setup: "pending",
      setupTerminalId: null,
      ports: {},
      processes: [],
      error: null,
    });
  });

  test("a daemon that never acks the watch exits 2 in the time limit and writes nothing", async () => {
    const silent = fakeDaemon({});
    const lines: string[] = [];
    const result = await runRunenvCli({ action: "watch" }, config(silent.port), {
      timeoutMs: 200,
      signal: new AbortController().signal,
      write: (l) => lines.push(l),
    });
    expect(result.code).toBe(2);
    expect(lines).toEqual([]);
  });
});

describe("flightdeckd runenv words (issue #3621)", () => {
  const argsOf = (argv: string[]) => {
    try {
      return parseArgs(argv);
    } catch (error) {
      return { refusedWith: (error as Error).message };
    }
  };

  test("`runenv config <project>`, `runenv get <card>` and `runenv watch` with no operand", () => {
    expect(argsOf(["runenv", "config", "api"])).toMatchObject({
      command: "runenv",
      action: "config",
      runenvTarget: "api",
    });
    expect(argsOf(["runenv", "get", "c1", "--json"])).toMatchObject({
      command: "runenv",
      action: "get",
      runenvTarget: "c1",
      json: true,
    });
    expect(argsOf(["runenv", "watch", "--host", "pi"])).toMatchObject({
      command: "runenv",
      action: "watch",
      host: "pi",
    });
  });

  test("a missing operand, an operand on watch and an unknown verb are refused", () => {
    expect(JSON.stringify(argsOf(["runenv", "get"]))).toContain("missing the card");
    expect(JSON.stringify(argsOf(["runenv", "config"]))).toContain("missing the project");
    expect(JSON.stringify(argsOf(["runenv", "watch", "c1"]))).toContain("unknown argument: c1");
    expect(JSON.stringify(argsOf(["runenv", "restart", "c1"]))).toContain("invalid runenv action");
  });
});
