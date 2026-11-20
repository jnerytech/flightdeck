import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { Budget } from "@flightdeck/protocol";
import { type BudgetCliArgs, runBudgetCli } from "../../src/costs/index.ts";
import { parseArgs } from "../../src/main.ts";
import { config, fakeDaemon, type Handlers, stopAll, TOKEN } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const DAY: Budget = {
  id: "b1",
  scope: "host",
  projectKey: null,
  period: "day",
  limitUsd: 5,
  limitPct: null,
  action: "queue",
  createdAt: "2026-11-20T09:00:00Z",
  periodKey: "2026-11-20",
  spentUsd: 1.2,
  spentPct: null,
  estimated: false,
  fraction: 0.24,
  crossed: [],
};

const WINDOW: Budget = {
  id: "b2",
  scope: "project",
  projectKey: "flightdeck",
  period: "five_hour",
  limitUsd: 0,
  limitPct: 0.2,
  action: "notify",
  createdAt: "2026-11-20T09:00:00Z",
  periodKey: "2026-11-20T15:00:00Z",
  spentUsd: 0.5,
  spentPct: 0.12,
  estimated: true,
  fraction: 0.6,
  crossed: [0.5],
};

const DAY_LINE = "b1  host  day  spent $1.20 of $5.00 (24%)  queue";
const WINDOW_LINE = "b2  project flightdeck  five_hour  spent ~12% of 20% (60%)  notify";

const HANDLERS: Handlers = {
  "budget.list": () => ({ budgets: [DAY, WINDOW] }),
  "budget.set": () => DAY,
  "budget.setQuota": () => WINDOW,
  "budget.remove": () => ({}),
};

const text = (r: { out: string[]; err: string[] }) => [...r.out, ...r.err].join("\n");
const sent = (daemon: { calls: Array<{ type: string; payload: unknown }> }, type: string) =>
  daemon.calls.find((call) => call.type === type)?.payload;
const budget = (args: BudgetCliArgs, daemon: { port: number }, timeoutMs?: number) =>
  runBudgetCli(args, config(daemon.port), timeoutMs ? { timeoutMs } : {});

function parsed(argv: string[]) {
  try {
    return parseArgs(argv);
  } catch (error) {
    return { error: (error as Error).message };
  }
}

describe("budget list (issue #3460)", () => {
  test("says one line per budget: a dollar limit and a share of a quota window", async () => {
    const result = await budget({ action: "list" }, fakeDaemon(HANDLERS));
    expect({ code: result.code, out: result.out }).toEqual({
      code: 0,
      out: [DAY_LINE, WINDOW_LINE],
    });
  });

  test("says so when there is no budget", async () => {
    const daemon = fakeDaemon({ "budget.list": () => ({ budgets: [] }) });
    const result = await budget({ action: "list" }, daemon);
    expect(result.out).toEqual(["no budget yet"]);
  });

  test("a share under one percent keeps its decimal, and a host's window budget has no estimate mark", async () => {
    const small: Budget = {
      ...WINDOW,
      id: "b3",
      scope: "host",
      projectKey: null,
      limitPct: 0.001,
      spentPct: 0,
      estimated: false,
      fraction: 0,
    };
    const daemon = fakeDaemon({ "budget.list": () => ({ budgets: [small] }) });
    const result = await budget({ action: "list" }, daemon);
    expect(result.out).toEqual(["b3  host  five_hour  spent 0% of 0.1% (0%)  notify"]);
  });

  test("a share of a tenth of a percent and a half keeps both decimals", async () => {
    const odd: Budget = { ...WINDOW, id: "b4", limitPct: 0.0015, spentPct: 0, fraction: 0 };
    const daemon = fakeDaemon({ "budget.list": () => ({ budgets: [odd] }) });
    const result = await budget({ action: "list" }, daemon);
    expect(result.out).toEqual([
      "b4  project flightdeck  five_hour  spent ~0% of 0.15% (0%)  notify",
    ]);
  });

  test("--json prints the daemon's answer", async () => {
    const result = await budget({ action: "list", json: true }, fakeDaemon(HANDLERS));
    expect(result.out).toEqual([JSON.stringify({ budgets: [DAY, WINDOW] }, null, 2)]);
  });

  test("no answer is exit 2, and a read says nothing of a write", async () => {
    const result = await budget({ action: "list" }, fakeDaemon({}), 200);
    expect(result.code).toBe(2);
    expect(text(result)).not.toContain("may or may not");
  });

  test("the token of the config is in none of the output", async () => {
    const result = await budget({ action: "list" }, fakeDaemon(HANDLERS));
    expect(text(result)).not.toContain(TOKEN);
  });
});

describe("budget set and set-quota (issue #3460)", () => {
  test("set sends the dollar limit as given and says the budget it made", async () => {
    const daemon = fakeDaemon(HANDLERS);
    const result = await budget(
      { action: "set", scope: "host", period: "day", limitUsd: 5, budgetAction: "queue" },
      daemon,
    );
    expect({ code: result.code, out: result.out, sent: sent(daemon, "budget.set") }).toEqual({
      code: 0,
      out: [DAY_LINE],
      sent: { scope: "host", period: "day", limitUsd: 5, action: "queue" },
    });
  });

  test("set of a project's budget names the project, and --id changes an existing budget", async () => {
    const daemon = fakeDaemon(HANDLERS);
    await budget(
      {
        action: "set",
        id: "b1",
        scope: "project",
        projectKey: "flightdeck",
        period: "month",
        limitUsd: 12.5,
        budgetAction: "notify",
      },
      daemon,
    );
    expect(sent(daemon, "budget.set")).toEqual({
      id: "b1",
      scope: "project",
      projectKey: "flightdeck",
      period: "month",
      limitUsd: 12.5,
      action: "notify",
    });
  });

  test("set-quota sends the share and the window, and says the budget it made", async () => {
    const daemon = fakeDaemon(HANDLERS);
    const result = await budget(
      {
        action: "set-quota",
        scope: "project",
        projectKey: "flightdeck",
        window: "five_hour",
        limitPct: 0.2,
        budgetAction: "notify",
      },
      daemon,
    );
    expect({ code: result.code, out: result.out, sent: sent(daemon, "budget.setQuota") }).toEqual({
      code: 0,
      out: [WINDOW_LINE],
      sent: {
        scope: "project",
        projectKey: "flightdeck",
        window: "five_hour",
        limitPct: 0.2,
        action: "notify",
      },
    });
  });

  test("--json prints the budget the daemon made", async () => {
    const result = await budget(
      {
        action: "set",
        scope: "host",
        period: "day",
        limitUsd: 5,
        budgetAction: "queue",
        json: true,
      },
      fakeDaemon(HANDLERS),
    );
    expect(result.out).toEqual([JSON.stringify(DAY, null, 2)]);
  });

  test("a refusal of the daemon is exit 1, and says nothing of an unknown result", async () => {
    const daemon = fakeDaemon({
      "budget.setQuota": () => ({
        error: { code: "featureOff", message: "quotaBudgets is off on this host" },
      }),
    });
    const result = await budget(
      {
        action: "set-quota",
        scope: "host",
        window: "seven_day",
        limitPct: 0.5,
        budgetAction: "queue",
      },
      daemon,
    );
    expect({ code: result.code, said: text(result).includes("quotaBudgets is off") }).toEqual({
      code: 1,
      said: true,
    });
    expect(text(result)).not.toContain("may or may not");
  });

  test("a write with no answer says its result is unknown, and where to look", async () => {
    const result = await budget(
      { action: "set", scope: "host", period: "day", limitUsd: 5, budgetAction: "queue" },
      fakeDaemon({}),
      200,
    );
    expect(result.code).toBe(2);
    expect(text(result)).toContain("may or may not");
    expect(text(result)).toContain("budget list");
  });
});

describe("budget remove (issue #3460)", () => {
  test("sends the id and says the budget is gone", async () => {
    const daemon = fakeDaemon(HANDLERS);
    const result = await budget({ action: "remove", id: "b1" }, daemon);
    expect({ code: result.code, out: result.out, sent: sent(daemon, "budget.remove") }).toEqual({
      code: 0,
      out: ["budget b1 removed"],
      sent: { id: "b1" },
    });
  });

  test("--json says which budget was removed", async () => {
    const result = await budget({ action: "remove", id: "b1", json: true }, fakeDaemon(HANDLERS));
    expect(result.out).toEqual([JSON.stringify({ removed: "b1" }, null, 2)]);
  });

  test("a budget the daemon does not know is exit 1", async () => {
    const daemon = fakeDaemon({
      "budget.remove": () => ({ error: { code: "notFound", message: "no budget b9" } }),
    });
    const result = await budget({ action: "remove", id: "b9" }, daemon);
    expect({ code: result.code, said: text(result).includes("no budget b9") }).toEqual({
      code: 1,
      said: true,
    });
  });

  test("a remove with no answer says its result is unknown", async () => {
    const result = await budget({ action: "remove", id: "b1" }, fakeDaemon({}), 200);
    expect(result.code).toBe(2);
    expect(text(result)).toContain("may or may not");
  });
});

describe("the arguments of budget (issue #3460)", () => {
  test("list takes no flag but --json", () => {
    expect(parsed(["budget", "list", "--json"])).toMatchObject({
      command: "budget",
      action: "list",
      json: true,
    });
  });

  test("set takes the scope, the period, the dollar limit and the action", () => {
    expect(
      parsed([
        "budget",
        "set",
        "--scope",
        "project",
        "--project",
        "flightdeck",
        "--period",
        "month",
        "--limit-usd",
        "12.50",
        "--action",
        "queue",
        "--id",
        "b1",
      ]),
    ).toMatchObject({
      command: "budget",
      action: "set",
      scope: "project",
      project: "flightdeck",
      budgetPeriod: "month",
      limitUsd: 12.5,
      budgetAction: "queue",
      budgetId: "b1",
    });
  });

  test("set-quota takes the window and the share", () => {
    expect(
      parsed([
        "budget",
        "set-quota",
        "--scope",
        "host",
        "--window",
        "seven_day",
        "--limit-pct",
        "0.001",
        "--action",
        "notify",
      ]),
    ).toMatchObject({
      command: "budget",
      action: "set-quota",
      scope: "host",
      budgetWindow: "seven_day",
      limitPct: 0.001,
      budgetAction: "notify",
    });
  });

  test("remove takes the budget's id", () => {
    expect(parsed(["budget", "remove", "b1"])).toMatchObject({
      command: "budget",
      action: "remove",
      budgetId: "b1",
    });
  });

  const SET = [
    "budget",
    "set",
    "--scope",
    "host",
    "--period",
    "day",
    "--limit-usd",
    "5",
    "--action",
    "queue",
  ];
  const SET_QUOTA = [
    "budget",
    "set-quota",
    "--scope",
    "host",
    "--window",
    "five_hour",
    "--limit-pct",
    "0.5",
    "--action",
    "queue",
  ];
  const without = (argv: string[], flag: string) => {
    const at = argv.indexOf(flag);
    return [...argv.slice(0, at), ...argv.slice(at + 2)];
  };
  const withScope = (argv: string[], scope: string) => {
    const at = argv.indexOf("--scope");
    return [...argv.slice(0, at + 1), scope, ...argv.slice(at + 2)];
  };

  test.each<[string, string[], string]>([
    ["no action", ["budget"], "invalid budget action: (none)"],
    ["an unknown action", ["budget", "reprice"], "invalid budget action: reprice"],
    ["set without the scope", without(SET, "--scope"), "missing --scope"],
    ["set without the period", without(SET, "--period"), "missing --period"],
    ["set without the limit", without(SET, "--limit-usd"), "missing --limit-usd"],
    ["set without the action", without(SET, "--action"), "missing --action"],
    ["set-quota without the window", without(SET_QUOTA, "--window"), "missing --window"],
    ["set-quota without the share", without(SET_QUOTA, "--limit-pct"), "missing --limit-pct"],
    [
      "a project scope without a project",
      withScope(SET, "project"),
      "--scope project needs --project",
    ],
    [
      "a host scope with a project",
      [...SET, "--project", "p"],
      "--project: only with --scope project",
    ],
    ["the persona's scope all", withScope(SET, "all"), "--scope: host or project"],
    [
      "a period that is not one",
      [...without(SET, "--period"), "--period", "week"],
      "--period: day or month",
    ],
    [
      "a window that is not one",
      [...without(SET_QUOTA, "--window"), "--window", "hour"],
      "--window: five_hour or seven_day",
    ],
    [
      "an action that is not one",
      [...without(SET, "--action"), "--action", "pause"],
      "--action: notify or queue",
    ],
    [
      "a limit of zero",
      [...without(SET, "--limit-usd"), "--limit-usd", "0"],
      "--limit-usd: a positive amount",
    ],
    [
      "a limit under a cent, which the list could not show",
      [...without(SET, "--limit-usd"), "--limit-usd", "0.001"],
      "--limit-usd: a positive amount",
    ],
    [
      "a limit in words",
      [...without(SET, "--limit-usd"), "--limit-usd", "five"],
      "--limit-usd: a positive amount",
    ],
    [
      "a limit in hex",
      [...without(SET, "--limit-usd"), "--limit-usd", "0x5"],
      "--limit-usd: a positive amount",
    ],
    [
      "a limit in exponent form",
      [...without(SET, "--limit-usd"), "--limit-usd", "1e3"],
      "--limit-usd: a positive amount",
    ],
    [
      "a share over one",
      [...without(SET_QUOTA, "--limit-pct"), "--limit-pct", "1.5"],
      "--limit-pct: a share from 0.001 to 1",
    ],
    [
      "a share under a tenth of a percent",
      [...without(SET_QUOTA, "--limit-pct"), "--limit-pct", "0.0001"],
      "--limit-pct: a share from 0.001 to 1",
    ],
    [
      "a share of off",
      [...without(SET_QUOTA, "--limit-pct"), "--limit-pct", "off"],
      "--limit-pct: a share from 0.001 to 1",
    ],
    ["a remove without the id", ["budget", "remove"], "missing the budget"],
    [
      "--id on a remove",
      ["budget", "remove", "b1", "--id", "b2"],
      "--id: this flag only applies to flightdeckd budget set and set-quota",
    ],
    [
      "--scope on a list",
      ["budget", "list", "--scope", "host"],
      "--scope: this flag only applies to flightdeckd budget set and set-quota",
    ],
    [
      "--period on set-quota",
      [...SET_QUOTA, "--period", "day"],
      "--period: this flag only applies to flightdeckd budget set",
    ],
    [
      "--limit-usd on set-quota",
      [...SET_QUOTA, "--limit-usd", "5"],
      "--limit-usd: this flag only applies to flightdeckd budget set",
    ],
    [
      "--window on set",
      [...SET, "--window", "five_hour"],
      "--window: this flag only applies to flightdeckd budget set-quota",
    ],
    [
      "--limit-pct on set",
      [...SET, "--limit-pct", "0.5"],
      "--limit-pct: this flag only applies to flightdeckd budget set-quota",
    ],
    [
      "an empty --id, which would make a new budget instead of changing one",
      [...SET, "--id", ""],
      "--id: a budget id",
    ],
    ["a remove of an empty id", ["budget", "remove", ""], "missing the budget"],
    [
      "--project on a list",
      ["budget", "list", "--project", "p"],
      "--project: this flag only applies to flightdeckd budget set and set-quota",
    ],
    [
      "--project on a remove",
      ["budget", "remove", "b1", "--project", "p"],
      "--project: this flag only applies to flightdeckd budget set and set-quota",
    ],
    [
      "--action on a list",
      ["budget", "list", "--action", "queue"],
      "--action: this flag only applies to flightdeckd budget set and set-quota",
    ],
    [
      "--period on usage",
      ["usage", "--period", "day"],
      "--period: this flag only applies to flightdeckd budget set",
    ],
    [
      "--limit-pct on a card",
      ["card", "list", "--limit-pct", "0.5"],
      "--limit-pct: this flag only applies to flightdeckd budget set-quota",
    ],
  ])("refuses %s before anything is sent", (_name, argv, message) => {
    const result = parsed(argv);
    expect({ refusedWith: "error" in result ? result.error.split("\n")[0] : undefined }).toEqual({
      refusedWith: message,
    });
  });

  test("the persona's --scope still works for persona", () => {
    expect(parsed(["persona", "list", "--scope", "all"])).toMatchObject({
      command: "persona",
      scope: "all",
    });
  });
});

describe("flightdeckd budget through the command line (issue #3460)", () => {
  test("budget list prints the lines and exits 0", async () => {
    const daemon = fakeDaemon(HANDLERS);
    const result = await flightdeckd(["budget", "list"], daemon.port);
    expect({ code: result.code, out: result.out }).toEqual({
      code: 0,
      out: [DAY_LINE, WINDOW_LINE],
    });
  });

  test("a bad flag exits 1 without calling the daemon", async () => {
    const daemon = fakeDaemon(HANDLERS);
    const result = await flightdeckd(["budget", "set", "--scope", "host"], daemon.port);
    expect({ code: result.code, calls: daemon.calls.length }).toEqual({ code: 1, calls: 0 });
  });
});
