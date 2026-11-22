import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { AccountState } from "@flightdeck/protocol";
import { runAccountCli } from "../../src/account/index.ts";
import { parseArgs } from "../../src/main.ts";
import { config, fakeDaemon, type Handlers, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";
import { watchedCli } from "../support/cli-watch.ts";
import { poll } from "../support/helpers.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const SIGNED_IN: AccountState = {
  status: "signed_in",
  name: "ana@example.com",
  organization: "Acme",
  plan: "max",
  provider: "firstParty",
  windows: [
    {
      window: "five_hour",
      utilization: 0.42,
      status: "allowed",
      resetsAt: "2026-11-20T15:00:00Z",
      readAt: "2026-11-20T10:00:00Z",
    },
  ],
  readAt: "2026-11-20T10:00:00Z",
  stale: false,
  error: null,
  source: "sdk",
  loginCommand: "claude auth login",
};
const SIGNED_OUT: AccountState = {
  ...SIGNED_IN,
  status: "signed_out",
  name: null,
  organization: null,
  plan: null,
  provider: null,
  windows: [],
  readAt: null,
  source: "status",
};

const OPEN: Handlers = {
  "account.get": () => SIGNED_IN,
  "account.refresh": () => ({ ...SIGNED_IN, plan: "pro" }),
};

/** The JSON a command printed; an empty output is `{}`, so a missing print fails by assertion. */
const asJson = (out: string[]) => JSON.parse(out.join("\n") || "{}");

const parsed = (argv: string[]): Record<string, unknown> => {
  try {
    return { ...parseArgs(argv) };
  } catch (error) {
    return { refusal: String((error as Error).message).split("\n")[0] };
  }
};

describe("the account arguments (issue #3703)", () => {
  test("get, refresh and watch take no operand, and carry --json and --host", () => {
    for (const verb of ["get", "refresh", "watch"]) {
      expect(parsed(["account", verb, "--json", "--host", "pi"])).toMatchObject({
        command: "account",
        action: verb,
        json: true,
        host: "pi",
      });
    }
  });

  test("a missing verb, an unknown one and an extra word are refused before any connection", () => {
    for (const line of [["account"], ["account", "nope"]]) {
      expect(parsed(line)).toHaveProperty("refusal", expect.stringContaining("account action"));
    }
    expect(parsed(["account", "get", "--query", "x"])).toHaveProperty(
      "refusal",
      expect.stringContaining("--query"),
    );
    expect(parsed(["account", "get", "extra"])).toHaveProperty(
      "refusal",
      expect.stringContaining("extra"),
    );
  });
});

describe("flightdeckd account get and refresh (issue #3703)", () => {
  test("get says who is signed in, the plan windows and when it was read", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["account", "get"], daemon.port);
    expect({ code: run.code, err: run.err }).toEqual({ code: 0, err: [] });
    expect(run.out).toEqual([
      "signed in as ana@example.com  Acme  max  firstParty",
      "five_hour  42%  allowed  resets 2026-11-20T15:00:00Z",
      "read 2026-11-20T10:00:00Z",
    ]);
  });

  test("a signed out host says what to run there, and a stale reading says the last read failed", async () => {
    const out = fakeDaemon({ "account.get": () => SIGNED_OUT });
    const signedOut = await flightdeckd(["account", "get"], out.port);
    expect(signedOut.out).toEqual([
      "signed out of Claude on this host: run `claude auth login` there to sign in",
      "not read yet",
    ]);
    const stale = fakeDaemon({
      "account.get": () => ({ ...SIGNED_IN, stale: true, error: "account_unavailable" }),
    });
    const run = await flightdeckd(["account", "get"], stale.port);
    expect(run.out).toContain(
      "the last read failed (account_unavailable): this is the previous reading",
    );
  });

  test("a first read that failed says so, though there is no previous reading", async () => {
    const daemon = fakeDaemon({
      "account.get": () => ({
        ...SIGNED_OUT,
        status: "unknown",
        stale: false,
        error: "account_unavailable",
      }),
    });
    const run = await flightdeckd(["account", "get"], daemon.port);
    expect(run.out).toEqual([
      "the account of this host is not known",
      "the last read failed (account_unavailable)",
      "not read yet",
    ]);
  });

  test("a field an older host leaves out is left out of the first line, not printed as a gap", async () => {
    const daemon = fakeDaemon({
      "account.get": () => {
        const { organization: _organization, ...older } = SIGNED_IN;
        return older;
      },
    });
    const run = await flightdeckd(["account", "get"], daemon.port);
    expect(run.out[0]).toBe("signed in as ana@example.com  max  firstParty");
  });

  test("--json prints the state with its windows and the login command", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["account", "get", "--json"], daemon.port);
    expect(asJson(run.out)).toEqual(SIGNED_IN);
  });

  test("refresh asks for a new read and prints the state it got", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["account", "refresh"], daemon.port);
    expect(run.code).toBe(0);
    expect(run.out[0]).toBe("signed in as ana@example.com  Acme  pro  firstParty");
    expect(daemon.calls.filter((c) => c.type === "account.refresh")).toHaveLength(1);
  });

  test("a refused read is exit 1 with the daemon's text, and no daemon is exit 2", async () => {
    const daemon = fakeDaemon({
      "account.get": () => ({ error: { code: "unsupported", message: "no account on this host" } }),
    });
    const refused = await flightdeckd(["account", "get"], daemon.port);
    expect([refused.code, refused.err.join("\n")]).toEqual([
      1,
      expect.stringContaining("no account on this host"),
    ]);
    const { port } = daemon;
    await stopAll();
    expect((await flightdeckd(["account", "get"], port)).code).toBe(2);
  });
});

describe("flightdeckd account watch (issue #3703)", () => {
  const updated = (state: AccountState = SIGNED_IN) => ({ type: "account.updated", ...state });

  const watched = (
    daemon: ReturnType<typeof fakeDaemon>,
    options: { lines?: number; json?: boolean; after?: (lines: string[]) => unknown } = {},
  ) =>
    watchedCli(
      daemon,
      "account.watch",
      (cfg, run) =>
        runAccountCli({ action: "watch", ...(options.json ? { json: true } : {}) }, cfg, run),
      options,
    );

  const CURRENT =
    "signed in as ana@example.com  Acme  max  firstParty | five_hour  42%  allowed  resets 2026-11-20T15:00:00Z | read 2026-11-20T10:00:00Z";
  const OUT =
    "signed out of Claude on this host: run `claude auth login` there to sign in | not read yet";

  test("it writes the current state first, then a line for each state the daemon pushes, and Ctrl-C ends it with 0", async () => {
    const daemon = fakeDaemon({ "account.watch": () => ({}), "account.get": () => SIGNED_IN });
    const { result, lines } = await watched(daemon, {
      lines: 3,
      after: async (written) => {
        // The current state is read after the watch is taken: a push that comes first would print before it (#4090).
        await poll(() => written.length >= 1);
        daemon.push(updated(SIGNED_OUT));
        daemon.push(updated());
      },
    });
    expect(lines).toEqual([CURRENT, OUT, CURRENT]);
    expect(result.code).toBe(0);
  });

  test("a watch started while the desktop app already watches is not silent: the current state comes first", async () => {
    const daemon = fakeDaemon({ "account.watch": () => ({}), "account.get": () => SIGNED_OUT });
    const { lines } = await watched(daemon, { lines: 1 });
    expect(lines).toEqual([OUT]);
  });

  test("--json writes the state of each update on one line, without the frame type", async () => {
    const daemon = fakeDaemon({ "account.watch": () => ({}), "account.get": () => SIGNED_IN });
    const { lines } = await watched(daemon, {
      json: true,
      lines: 2,
      after: async (written) => {
        await poll(() => written.length >= 1);
        daemon.push(updated(SIGNED_OUT));
      },
    });
    expect(lines.map((line) => JSON.parse(line))).toEqual([SIGNED_IN, SIGNED_OUT]);
  });

  test("a refused watch is exit 1, and a daemon that never acks it is exit 2", async () => {
    const refused = fakeDaemon({
      "account.watch": () => ({ error: { code: "unsupported", message: "no account here" } }),
    });
    // A refusal ends the command on its own: pressing Ctrl-C before it is read would end it with 0 instead (#4090).
    const result = await runAccountCli({ action: "watch" }, config(refused.port), {
      timeoutMs: 2000,
      signal: new AbortController().signal,
      write: () => undefined,
    });
    expect(result.code).toBe(1);
    const silent = fakeDaemon({ "account.watch": () => undefined });
    const never = await runAccountCli({ action: "watch" }, config(silent.port), {
      timeoutMs: 300,
      signal: new AbortController().signal,
      write: () => undefined,
    });
    expect(never.code).toBe(2);
  });
});
