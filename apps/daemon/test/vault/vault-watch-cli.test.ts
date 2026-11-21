import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { CliResult } from "../../src/daemon-client/index.ts";
import { parseArgs } from "../../src/main.ts";
import { runVaultCli } from "../../src/vault/index.ts";
import { CLOSE, config, EMPTY_ACK, fakeDaemon, stopAll } from "../board/card-cli-helpers.ts";
import { poll } from "../support/helpers.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

/**
 * Issue #3753: `flightdeckd vault watch` follows the secret requests and uses of the host from a terminal,
 * and `vault deny <requestId>` refuses one. Neither prints a secret value, and `vault deny` never says
 * "denied" for a request that was not there to refuse.
 */
const text = (r: CliResult) => [...r.out, ...r.err].join("\n");
const calls = (daemon: ReturnType<typeof fakeDaemon>, type: string) =>
  daemon.calls.filter((c) => c.type === type);
function parsed(argv: string[]): unknown {
  try {
    return parseArgs(argv);
  } catch (error) {
    return { refusedWith: (error as Error).message };
  }
}

const request = (over: Record<string, unknown> = {}) => ({
  type: "vault.request",
  requestId: "q1",
  secretId: "db-pass",
  purpose: "action",
  requester: "claude",
  action: "deploy",
  host: "pi",
  decision: "ask",
  ruleId: null,
  reason: "no rule covers this use",
  ...over,
});
const used = (over: Record<string, unknown> = {}) => ({
  type: "vault.used",
  secretId: "db-pass",
  purpose: "action",
  requester: "claude",
  action: "deploy",
  at: "2026-11-20T10:00:00.000Z",
  ...over,
});

/** Runs `vault watch` once the daemon has it, then presses Ctrl-C when `lines` lines came. */
async function watched(
  daemon: ReturnType<typeof fakeDaemon>,
  options: { json?: boolean; timeoutMs?: number; lines?: number; after?: () => unknown } = {},
) {
  const lines: string[] = [];
  const stop = new AbortController();
  const running = runVaultCli(
    { action: "watch", ...(options.json ? { json: true } : {}) },
    config(daemon.port),
    { timeoutMs: options.timeoutMs ?? 2000, signal: stop.signal, write: (l) => lines.push(l) },
  );
  await poll(() => daemon.calls.some((c) => c.type === "vault.watch"));
  await options.after?.();
  await poll(() => lines.length >= (options.lines ?? 1));
  stop.abort();
  return { result: await running, lines };
}

describe("flightdeckd vault watch (issue #3753)", () => {
  test("a line for each request and each use, then Ctrl-C ends it with 0", async () => {
    const daemon = fakeDaemon({ "vault.watch": () => ({}) });
    const { result, lines } = await watched(daemon, {
      lines: 2,
      after: () => {
        daemon.push(request());
        daemon.push(used());
      },
    });
    expect(lines).toEqual([
      "request q1  db-pass  claude  action deploy on pi  ask: no rule covers this use",
      "used  db-pass  claude  action deploy  2026-11-20T10:00:00.000Z",
    ]);
    expect(result.code).toBe(0);
    expect(calls(daemon, "vault.watch")).toHaveLength(1);
  });

  test("a request a rule lets through says which rule, and a held one says so", async () => {
    const daemon = fakeDaemon({ "vault.watch": () => ({}) });
    const { lines } = await watched(daemon, {
      lines: 2,
      after: () => {
        daemon.push(
          request({ decision: "allow", ruleId: "r7", reason: "a rule lets claude deploy" }),
        );
        daemon.push(request({ requestId: "q2", needsHold: true, once: true }));
      },
    });
    expect(lines).toEqual([
      "request q1  db-pass  claude  action deploy on pi  allow by rule r7: a rule lets claude deploy",
      "request q2  db-pass  claude  action deploy on pi  ask: no rule covers this use  [approval must be held 2 s] [once per session]",
    ]);
  });

  test("a run_with_secret request says what would run", async () => {
    const daemon = fakeDaemon({ "vault.watch": () => ({}) });
    const { lines } = await watched(daemon, {
      after: () =>
        daemon.push(
          request({
            purpose: "run_with_secret",
            action: undefined,
            command: "psql -c 'select 1'",
            secrets: ["db-pass"],
          }),
        ),
    });
    expect(lines[0]).toBe(
      "request q1  db-pass  claude  run_with_secret on pi  ask: no rule covers this use  runs: psql -c 'select 1'",
    );
  });

  test("the text never carries a parameter, and a terminal control in the daemon's words is replaced", async () => {
    const daemon = fakeDaemon({ "vault.watch": () => ({}) });
    const { lines } = await watched(daemon, {
      after: () =>
        daemon.push(request({ params: { token: "hunter2" }, reason: "\u001b[2Jwiped 🙂" })),
    });
    expect(lines.join("\n")).not.toContain("hunter2");
    expect(lines.join("\n")).not.toContain("\u001b");
    expect(lines.join("\n")).toContain("wiped 🙂");
  });

  test("--json writes one frame per line, for a script", async () => {
    const daemon = fakeDaemon({ "vault.watch": () => ({}) });
    const { lines } = await watched(daemon, {
      json: true,
      lines: 2,
      after: () => {
        daemon.push(request());
        daemon.push(used());
      },
    });
    expect(lines.map((l) => JSON.parse(l).type)).toEqual(["vault.request", "vault.used"]);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({ requestId: "q1", secretId: "db-pass" });
  });

  test("an alert is not printed", async () => {
    const daemon = fakeDaemon({ "vault.watch": () => ({}) });
    const { lines } = await watched(daemon, {
      after: () => {
        daemon.push({
          type: "vault.alert",
          kind: "limit",
          secretId: "s",
          requester: "claude",
          message: "m",
          at: "t",
        });
        daemon.push(used());
      },
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.startsWith("used")).toBe(true);
  });

  test("a frame the daemon pushes before the ack is not lost", async () => {
    const daemon = fakeDaemon({
      "vault.watch": (_payload, ctx) => {
        ctx.push(request());
        return {};
      },
    });
    const { lines } = await watched(daemon);
    expect(lines[0]?.startsWith("request q1")).toBe(true);
  });

  test("a refused watch exits 1 with the daemon's code", async () => {
    const daemon = fakeDaemon({
      "vault.watch": () => ({ error: { code: "unavailable", message: "no vault here" } }),
    });
    const { result } = await watched(daemon, { lines: 0 });
    expect(result.code).toBe(1);
    expect(text(result)).toContain("unavailable: no vault here");
  });

  test("a daemon that never acks the watch exits 2 in the time limit and writes nothing", async () => {
    const silent = fakeDaemon({});
    const lines: string[] = [];
    const result = await runVaultCli({ action: "watch" }, config(silent.port), {
      timeoutMs: 200,
      signal: new AbortController().signal,
      write: (l) => lines.push(l),
    });
    expect({ code: result.code, lines }).toEqual({ code: 2, lines: [] });
    expect(text(result)).toContain("did not answer");
  });

  test("no daemon at all is exit 2", async () => {
    const result = await runVaultCli({ action: "watch" }, config(1), { timeoutMs: 500 });
    expect(result.code).toBe(2);
  });
});

describe("flightdeckd vault deny (issue #3753)", () => {
  test("it sends the request id, says it was denied and exits 0", async () => {
    const daemon = fakeDaemon({ "vault.deny": () => ({ denied: true }) });
    const result = await runVaultCli({ action: "deny", requestId: "q1" }, config(daemon.port));
    expect({ code: result.code, out: result.out, err: result.err }).toEqual({
      code: 0,
      out: ["denied q1"],
      err: [],
    });
    expect(calls(daemon, "vault.deny").map((c) => c.payload)).toEqual([{ requestId: "q1" }]);
  });

  test("a request that was not there is exit 1: it is never said to be denied", async () => {
    const daemon = fakeDaemon({ "vault.deny": () => ({ denied: false }) });
    const result = await runVaultCli({ action: "deny", requestId: "zz" }, config(daemon.port));
    expect({ code: result.code, out: result.out }).toEqual({ code: 1, out: [] });
    expect(text(result)).toContain("request zz is not waiting");
    expect(text(result)).not.toContain("denied zz");
  });

  test("a daemon from before the answer carried it is taken at its word", async () => {
    const daemon = fakeDaemon({ "vault.deny": () => ({}) });
    const result = await runVaultCli({ action: "deny", requestId: "q1" }, config(daemon.port));
    expect({ code: result.code, out: result.out }).toEqual({ code: 0, out: ["denied q1"] });
  });

  test("a daemon that acks with no data at all is taken at its word too", async () => {
    const daemon = fakeDaemon({ "vault.deny": () => EMPTY_ACK });
    const result = await runVaultCli({ action: "deny", requestId: "q1" }, config(daemon.port));
    expect({ code: result.code, out: result.out, err: result.err }).toEqual({
      code: 0,
      out: ["denied q1"],
      err: [],
    });
  });

  test("--json prints the request and whether it was denied", async () => {
    const daemon = fakeDaemon({ "vault.deny": () => ({ denied: true }) });
    const result = await runVaultCli(
      { action: "deny", requestId: "q1", json: true },
      config(daemon.port),
    );
    expect(JSON.parse(result.out.join("\n"))).toEqual({ requestId: "q1", denied: true });
  });

  test("a refusal is the daemon's text and exit 1", async () => {
    const daemon = fakeDaemon({
      "vault.deny": () => ({ error: { code: "unavailable", message: "no vault here" } }),
    });
    const result = await runVaultCli({ action: "deny", requestId: "q1" }, config(daemon.port));
    expect({ code: result.code, out: result.out }).toEqual({ code: 1, out: [] });
    expect(text(result)).toContain("no vault here");
  });

  test("a connection that closes after the request went out says it may or may not have been denied, exit 2", async () => {
    const daemon = fakeDaemon({ "vault.deny": () => CLOSE });
    const result = await runVaultCli({ action: "deny", requestId: "q1" }, config(daemon.port));
    expect(result.code).toBe(2);
    expect(text(result)).toContain("may or may not have been denied");
  });

  test("no daemon at all is exit 2", async () => {
    const result = await runVaultCli({ action: "deny", requestId: "q1" }, config(1));
    expect(result.code).toBe(2);
  });
});

describe("flightdeckd vault watch and deny arguments (issue #3753)", () => {
  test("watch takes --json and nothing else", () => {
    expect(parsed(["vault", "watch", "--json"])).toMatchObject({
      command: "vault",
      action: "watch",
      json: true,
    });
    expect(parsed(["vault", "watch", "--days", "7"])).toMatchObject({
      refusedWith: expect.stringContaining("--days: this flag only applies"),
    });
  });

  test("deny needs the request id, before it connects", () => {
    expect(parsed(["vault", "deny", "q1"])).toMatchObject({
      command: "vault",
      action: "deny",
      requestId: "q1",
    });
    expect(parsed(["vault", "deny"])).toMatchObject({
      refusedWith: expect.stringContaining("the request"),
    });
  });

  test("deny takes no --confirm: refusing a request only tightens", () => {
    expect(parsed(["vault", "deny", "q1", "--confirm"])).toMatchObject({
      refusedWith: expect.stringContaining("--confirm"),
    });
  });
});
