import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type {
  CostsSession,
  CostsStatus,
  CostsSummary,
  RoiSummaryResult,
} from "@flightdeck/protocol";
import { type CostsCliArgs, runCostsCli } from "../../src/costs/index.ts";
import { parseArgs } from "../../src/main.ts";
import { runRoiCli } from "../../src/roi/index.ts";
import { config, fakeDaemon, type Handlers, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const SUMMARY: CostsSummary = {
  from: "2026-11-01",
  to: "2026-11-20",
  totals: {
    costUsd: 12.345,
    tokens: { input: 1000, output: 500, cacheRead: 200, cacheWrite5m: 30, cacheWrite1h: 40 },
    cacheSavingsUsd: 1.5,
    messages: 40,
    unpricedMessages: 0,
  },
  byDay: [],
  byProject: [{ projectKey: "flightdeck", costUsd: 10, tokens: 1500 }],
  byModel: [
    { model: "claude-sonnet-5-5", costUsd: 12, tokens: 1500, priced: true },
    { model: "mystery-model", costUsd: 0, tokens: 70, priced: false },
  ],
  byOrigin: [{ origin: "card", costUsd: 8, tokens: 1000 }],
  byPersona: [
    { persona: "developer", costUsd: 6, tokens: 900 },
    { persona: null, costUsd: 4, tokens: 600 },
  ],
  topSessions: [
    {
      claudeSessionId: "abc-123",
      sessionId: null,
      projectKey: "flightdeck",
      title: "Fix the login",
      cwd: null,
      costUsd: 3.2,
      tokens: 800,
    },
  ],
};

const SESSION: CostsSession = {
  claudeSessionId: "abc-123",
  costUsd: 3.2,
  tokens: 800,
  subagentCostUsd: 0.5,
  byModel: [{ model: "claude-sonnet-5-5", costUsd: 3.2, tokens: 800 }],
};

const STATUS: CostsStatus = {
  initialLoad: { state: "done", filesDone: 10, filesTotal: 10 },
  pricingDate: "2026-11-01",
  unpriced: [{ model: "mystery-model", entries: 3, tokens: 70 }],
  divergences: [
    { claudeSessionId: "abc-123", model: "claude-sonnet-5-5", computedUsd: 2, sdkUsd: 3 },
  ],
  telemetryDivergences: [],
};

const PERIOD = {
  costUsd: 5,
  tokens: 2000,
  cards: 4,
  planned: 3,
  unplanned: 1,
  prsMerged: 2,
  plannedPrs: 1,
  unplannedPrs: 1,
  issuesResolved: 1,
  fixRounds: 1,
  fixCostUsd: 0.5,
  hours: 6,
  cardsWithoutEstimate: 1,
  decisions: 7,
  waitedSeconds: 60,
  outsideCardsUsd: 0.25,
  approxCards: 0,
  weeks: [],
};

const ROI: RoiSummaryResult = {
  from: "2026-11-01",
  to: "2026-11-20",
  previousFrom: "2026-10-12",
  previousTo: "2026-10-31",
  projects: [
    {
      projectKey: "flightdeck",
      name: "Flightdeck",
      current: PERIOD,
      previous: { ...PERIOD, costUsd: 4, cards: 2 },
    },
  ],
};

const HANDLERS: Handlers = {
  "costs.summary": () => SUMMARY,
  "costs.session": () => SESSION,
  "costs.card": () => ({ costUsd: 1.234 }),
  "costs.run": () => ({ costUsd: 0.5 }),
  "costs.status": () => STATUS,
  "costs.export": () => ({
    csv: "day,project,cost\n2026-11-20,flightdeck,1\n",
    filename: "costs.csv",
  }),
  "roi.summary": () => ROI,
};

const sent = (daemon: { calls: Array<{ type: string; payload: unknown }> }, type: string) =>
  daemon.calls.find((call) => call.type === type)?.payload;
const costs = (args: CostsCliArgs, daemon: { port: number }, timeoutMs?: number) =>
  runCostsCli(args, config(daemon.port), timeoutMs ? { timeoutMs } : {});

describe("costs summary and export (issue #3460)", () => {
  test("summary sends the days and filters as given and says totals, then each group", async () => {
    const daemon = fakeDaemon(HANDLERS);
    const result = await costs(
      {
        action: "summary",
        from: "2026-11-01",
        to: "2026-11-20",
        projectKey: "flightdeck",
        model: "claude-sonnet-5-5",
        origin: "card",
      },
      daemon,
    );
    expect({ code: result.code, out: result.out, sent: sent(daemon, "costs.summary") }).toEqual({
      code: 0,
      out: [
        "2026-11-01 to 2026-11-20: $12.35, 40 messages",
        "tokens: 1000 in, 500 out, 200 cache read, 70 cache write",
        "cache saved $1.50",
        "project  flightdeck  $10.00",
        "model  claude-sonnet-5-5  $12.00",
        "model  mystery-model  no price, 70 tokens",
        "origin  card  $8.00",
        "persona  developer  $6.00",
        "persona  none  $4.00",
        "session  abc-123  Fix the login  $3.20",
      ],
      sent: {
        from: "2026-11-01",
        to: "2026-11-20",
        projectKey: "flightdeck",
        model: "claude-sonnet-5-5",
        origin: "card",
      },
    });
  });

  test("messages without a price are counted in the first line", async () => {
    const daemon = fakeDaemon({
      "costs.summary": () => ({
        ...SUMMARY,
        totals: { ...SUMMARY.totals, unpricedMessages: 3 },
      }),
    });
    const result = await costs({ action: "summary", from: "2026-11-01", to: "2026-11-20" }, daemon);
    expect(result.out[0]).toBe("2026-11-01 to 2026-11-20: $12.35, 40 messages (3 without a price)");
  });

  test("export prints the csv as it is and sends the same days", async () => {
    const daemon = fakeDaemon(HANDLERS);
    const result = await costs({ action: "export", from: "2026-11-01", to: "2026-11-20" }, daemon);
    expect({ code: result.code, out: result.out, sent: sent(daemon, "costs.export") }).toEqual({
      code: 0,
      out: ["day,project,cost", "2026-11-20,flightdeck,1"],
      sent: { from: "2026-11-01", to: "2026-11-20" },
    });
  });

  test("--json prints the daemon's answer", async () => {
    const result = await costs(
      { action: "summary", from: "2026-11-01", to: "2026-11-20", json: true },
      fakeDaemon(HANDLERS),
    );
    expect(result.out).toEqual([JSON.stringify(SUMMARY, null, 2)]);
  });
});

describe("costs session, card, run and status (issue #3460)", () => {
  test("session says the cost, the subagents' part and each model", async () => {
    const daemon = fakeDaemon(HANDLERS);
    const result = await costs({ action: "session", id: "abc-123" }, daemon);
    expect({ code: result.code, out: result.out, sent: sent(daemon, "costs.session") }).toEqual({
      code: 0,
      out: [
        "abc-123: $3.20, 800 tokens, $0.50 of it by subagents",
        "model  claude-sonnet-5-5  $3.20  800 tokens",
      ],
      sent: { claudeSessionId: "abc-123" },
    });
  });

  test("card and run say one cost, each asking with its own id", async () => {
    const daemon = fakeDaemon(HANDLERS);
    const card = await costs({ action: "card", id: "c1" }, daemon);
    const run = await costs({ action: "run", id: "r1" }, daemon);
    expect({
      card: [card.out, sent(daemon, "costs.card")],
      run: [run.out, sent(daemon, "costs.run")],
    }).toEqual({
      card: [["card c1: $1.23"], { cardId: "c1" }],
      run: [["run r1: $0.50"], { runId: "r1" }],
    });
  });

  test("status says the load, the price date, the models without a price and the divergences", async () => {
    const result = await costs({ action: "status" }, fakeDaemon(HANDLERS));
    expect(result.out).toEqual([
      "transcripts: done, 10 of 10 files",
      "prices from 2026-11-01",
      "no price: mystery-model (3 messages, 70 tokens)",
      "differs from the SDK: abc-123  claude-sonnet-5-5  computed $2.00, SDK $3.00",
    ]);
  });

  test("a status with nothing to flag says so", async () => {
    const daemon = fakeDaemon({
      "costs.status": () => ({
        ...STATUS,
        initialLoad: { state: "running", filesDone: 4, filesTotal: 10 },
        unpriced: [],
        divergences: [],
      }),
    });
    expect((await costs({ action: "status" }, daemon)).out).toEqual([
      "transcripts: running, 4 of 10 files",
      "prices from 2026-11-01",
      "every model has a price, and no session differs from the SDK",
    ]);
  });

  test("a daemon that never answers is exit 2", async () => {
    expect((await costs({ action: "status" }, fakeDaemon({}), 200)).code).toBe(2);
  });
});

describe("roi (issue #3460)", () => {
  test("says each project's period against the one before it", async () => {
    const daemon = fakeDaemon(HANDLERS);
    const result = await runRoiCli(
      { from: "2026-11-01", to: "2026-11-20", projectKey: "flightdeck" },
      config(daemon.port),
    );
    expect({ code: result.code, out: result.out, sent: sent(daemon, "roi.summary") }).toEqual({
      code: 0,
      out: [
        "2026-11-01 to 2026-11-20, against 2026-10-12 to 2026-10-31",
        "Flightdeck (flightdeck)",
        "  cost  $5.00  (before $4.00)",
        "  cards  4  (before 2)",
        "  PRs merged  2",
        "  hours  6, 1 cards without an estimate",
      ],
      sent: { from: "2026-11-01", to: "2026-11-20", projectKey: "flightdeck" },
    });
  });

  test("no project in the period is said", async () => {
    const daemon = fakeDaemon({ "roi.summary": () => ({ ...ROI, projects: [] }) });
    const result = await runRoiCli({ from: "2026-11-01", to: "2026-11-20" }, config(daemon.port));
    expect(result.out).toEqual([
      "2026-11-01 to 2026-11-20, against 2026-10-12 to 2026-10-31",
      "no project in that time",
    ]);
  });
});

describe("flightdeckd costs and roi, as the terminal runs them (issue #3460)", () => {
  async function terminal(argv: string[]) {
    const daemon = fakeDaemon(HANDLERS);
    try {
      return { ...(await flightdeckd(argv, daemon.port)), daemon };
    } catch (error) {
      return { out: [], err: [String(error)], code: -1, daemon };
    }
  }

  test("each command reaches the daemon with its payload and exits 0", async () => {
    const summary = await terminal([
      "costs",
      "summary",
      "--from",
      "2026-11-01",
      "--to",
      "2026-11-20",
      "--project",
      "flightdeck",
      "--model",
      "m",
      "--origin",
      "card",
      "--json",
    ]);
    expect([summary.code, sent(summary.daemon, "costs.summary")]).toEqual([
      0,
      {
        from: "2026-11-01",
        to: "2026-11-20",
        projectKey: "flightdeck",
        model: "m",
        origin: "card",
      },
    ]);
    const session = await terminal(["costs", "session", "abc-123"]);
    expect([session.code, sent(session.daemon, "costs.session")]).toEqual([
      0,
      { claudeSessionId: "abc-123" },
    ]);
    const roi = await terminal(["roi", "--from", "2026-11-01", "--to", "2026-11-20"]);
    expect([roi.code, sent(roi.daemon, "roi.summary")]).toEqual([
      0,
      { from: "2026-11-01", to: "2026-11-20" },
    ]);
  });

  test("a date that is not YYYY-MM-DD is exit 1 and sends nothing", async () => {
    const result = await terminal([
      "costs",
      "summary",
      "--from",
      "yesterday",
      "--to",
      "2026-11-20",
    ]);
    expect(result.code).toBe(1);
    expect(result.err.join("\n")).toContain("--from needs a day as YYYY-MM-DD");
    expect(sent(result.daemon, "costs.summary")).toBeUndefined();
  });
});

describe("costs and roi: the arguments (issue #3460)", () => {
  const parsed = (argv: string[]) => {
    try {
      return parseArgs(argv);
    } catch (error) {
      return { error: String(error) };
    }
  };

  test("each verb takes its operand and flags", () => {
    expect(
      parsed([
        "costs",
        "summary",
        "--from",
        "2026-11-01",
        "--to",
        "2026-11-20",
        "--origin",
        "card",
      ]),
    ).toMatchObject({
      command: "costs",
      action: "summary",
      from: "2026-11-01",
      dateTo: "2026-11-20",
      origin: "card",
    });
    expect(parsed(["costs", "session", "abc-123"])).toMatchObject({
      action: "session",
      costsId: "abc-123",
    });
    expect(parsed(["costs", "card", "c1"])).toMatchObject({ action: "card", costsId: "c1" });
    expect(parsed(["costs", "run", "r1"])).toMatchObject({ action: "run", costsId: "r1" });
    expect(parsed(["costs", "status", "--json"])).toMatchObject({ action: "status", json: true });
    expect(
      parsed(["roi", "--from", "2026-11-01", "--to", "2026-11-20", "--project", "k"]),
    ).toMatchObject({
      command: "roi",
      project: "k",
    });
  });

  test("summary, export and roi need both days; session, card and run need an id", () => {
    for (const argv of [
      ["costs", "summary", "--to", "2026-11-20"],
      ["costs", "export", "--from", "2026-11-01"],
      ["roi", "--from", "2026-11-01"],
    ])
      expect(parsed(argv)).toMatchObject({ error: expect.stringContaining("--from and --to") });
    for (const verb of ["session", "card", "run"])
      expect(parsed(["costs", verb])).toMatchObject({ error: expect.stringContaining("missing") });
  });

  test("a day is YYYY-MM-DD and a real date, and --origin is one the daemon knows", () => {
    for (const bad of ["yesterday", "2026-1-1", "2026-13-01", "2026-02-30"])
      expect(parsed(["costs", "summary", "--from", bad, "--to", "2026-11-20"])).toMatchObject({
        error: expect.stringContaining("--from"),
      });
    expect(
      parsed(["costs", "summary", "--from", "2026-11-01", "--to", "2026-11-20", "--origin", "x"]),
    ).toMatchObject({
      error: expect.stringContaining("--origin"),
    });
  });

  test("the day and filter flags belong to costs summary, costs export and roi", () => {
    expect(parsed(["costs", "status", "--from", "2026-11-01"])).toMatchObject({
      error: expect.stringContaining("--from"),
    });
    expect(parsed(["costs", "card", "c1", "--model", "m"])).toMatchObject({
      error: expect.stringContaining("--model"),
    });
    expect(
      parsed(["roi", "--from", "2026-11-01", "--to", "2026-11-20", "--origin", "card"]),
    ).toMatchObject({
      error: expect.stringContaining("--origin"),
    });
    expect(parsed(["usage", "--to", "2026-11-20"])).toMatchObject({
      error: expect.stringContaining("--to"),
    });
  });
  test("--model on roi names the costs verbs it belongs to, not persona", () => {
    expect(
      parsed(["roi", "--from", "2026-11-01", "--to", "2026-11-20", "--model", "m"]),
    ).toMatchObject({ error: expect.stringContaining("flightdeckd costs summary and export") });
  });

  test("a first day after the last day is refused before anything is sent", () => {
    for (const argv of [
      ["costs", "summary", "--from", "2026-11-20", "--to", "2026-11-01"],
      ["costs", "export", "--from", "2026-11-20", "--to", "2026-11-01"],
      ["roi", "--from", "2026-11-20", "--to", "2026-11-01"],
    ])
      expect(parsed(argv)).toMatchObject({
        error: expect.stringContaining("--from is after --to"),
      });
    expect(parsed(["roi", "--from", "2026-11-20", "--to", "2026-11-20"])).toMatchObject({
      command: "roi",
    });
  });
});
