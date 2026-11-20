import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { CliResult } from "../../src/daemon-client/index.ts";
import { parseArgs } from "../../src/main.ts";
import { runVaultCli } from "../../src/vault/index.ts";
import { config, fakeDaemon, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const text = (r: CliResult) => [...r.out, ...r.err].join("\n");
/** The parsed arguments, or what the parser refused with: a wrong parse fails an assertion. */
function parsed(argv: string[]): unknown {
  try {
    return parseArgs(argv);
  } catch (error) {
    return { refusedWith: (error as Error).message };
  }
}
const calls = (daemon: ReturnType<typeof fakeDaemon>, type: string) =>
  daemon.calls.filter((c) => c.type === type);

const decision = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  at: "2026-11-20T10:00:00.000Z",
  secretId: "db-pass",
  requester: "claude",
  purpose: "action",
  action: "deploy",
  host: "pi",
  project: null,
  session: null,
  ruleId: "r1",
  decision: "allow",
  outcome: "allowed",
  approver: "rule",
  window: null,
  reason: "a rule lets claude deploy",
  ...over,
});
const verdict = (over: Record<string, unknown> = {}) => ({
  decision: "ask",
  ruleId: null,
  reason: "no rule covers this use",
  once: false,
  needsHold: false,
  limited: false,
  ...over,
});

describe("flightdeckd vault decisions (issue #3458)", () => {
  test("it sends only what was typed and prints one line per decision", async () => {
    const daemon = fakeDaemon({
      "vault.decisions": () => ({
        decisions: [
          decision("d1"),
          decision("d2", {
            requester: "automation",
            purpose: "ssh",
            action: null,
            decision: "ask",
            outcome: "denied",
            approver: null,
            ruleId: null,
            reason: "denied in the app",
          }),
        ],
      }),
    });
    const result = await runVaultCli(
      { action: "decisions", secretId: "db-pass", days: 7, limit: 20 },
      config(daemon.port),
    );
    expect(result.code).toBe(0);
    expect(calls(daemon, "vault.decisions")).toEqual([
      { type: "vault.decisions", payload: { secretId: "db-pass", days: 7, limit: 20 } },
    ]);
    expect(result.out).toEqual([
      "2026-11-20T10:00:00.000Z  db-pass  claude  action deploy on pi  allow/allowed (rule)  a rule lets claude deploy",
      "2026-11-20T10:00:00.000Z  db-pass  automation  ssh on pi  ask/denied  denied in the app",
    ]);
  });

  test("with nothing typed it sends an empty payload, and an empty audit says so", async () => {
    const daemon = fakeDaemon({ "vault.decisions": () => ({ decisions: [] }) });
    const result = await runVaultCli({ action: "decisions" }, config(daemon.port));
    expect(calls(daemon, "vault.decisions")[0]?.payload).toEqual({});
    expect(result.out).toEqual(["no decisions"]);
  });

  test("--json prints the daemon's answer", async () => {
    const answer = { decisions: [decision("d1")] };
    const daemon = fakeDaemon({ "vault.decisions": () => answer });
    const result = await runVaultCli({ action: "decisions", json: true }, config(daemon.port));
    expect(result.out).toEqual([JSON.stringify(answer, null, 2)]);
  });

  test("a reason cannot drive the terminal", async () => {
    const daemon = fakeDaemon({
      "vault.decisions": () => ({ decisions: [decision("d1", { reason: "ok\u001b[2J gone" })] }),
    });
    const result = await runVaultCli({ action: "decisions" }, config(daemon.port));
    expect(text(result)).not.toContain("\u001b");
    expect(text(result)).toContain("ok [2J gone");
  });

  test("a refusal exits 1 with the daemon's code and reason", async () => {
    const daemon = fakeDaemon({
      "vault.decisions": () => ({ error: { code: "invalid", message: "days: too big" } }),
    });
    const result = await runVaultCli({ action: "decisions", days: 7 }, config(daemon.port));
    expect(result.code).toBe(1);
    expect(text(result)).toContain("invalid: days: too big");
  });

  test("no answer exits 2", async () => {
    const silent = fakeDaemon({});
    const result = await runVaultCli({ action: "decisions" }, config(silent.port), {
      timeoutMs: 200,
    });
    expect(result.code).toBe(2);
  });
});

describe("flightdeckd vault report (issue #3458)", () => {
  const rows = [
    { secretId: "db-pass", requester: "claude", outcome: "allowed", count: 12 },
    { secretId: "db-pass", requester: "you", outcome: "denied", count: 1 },
  ];

  test("it prints one line per row of uses by secret, requester and outcome", async () => {
    const daemon = fakeDaemon({ "vault.report": () => ({ rows }) });
    const result = await runVaultCli({ action: "report", days: 30 }, config(daemon.port));
    expect(calls(daemon, "vault.report")[0]?.payload).toEqual({ days: 30 });
    expect(result.out).toEqual(["db-pass  claude  allowed  12", "db-pass  you  denied  1"]);
  });

  test("--csv asks for the CSV and prints it as the app saves it", async () => {
    const csv = "secret,requester,outcome,count\ndb-pass,claude,allowed,12\n";
    const daemon = fakeDaemon({ "vault.report": () => ({ rows, csv }) });
    const result = await runVaultCli({ action: "report", csv: true }, config(daemon.port));
    expect(calls(daemon, "vault.report")[0]?.payload).toEqual({ format: "csv" });
    expect(result.out).toEqual(["secret,requester,outcome,count", "db-pass,claude,allowed,12", ""]);
  });

  test("an empty report says so, and --json prints the answer", async () => {
    const daemon = fakeDaemon({ "vault.report": () => ({ rows: [] }) });
    expect((await runVaultCli({ action: "report" }, config(daemon.port))).out).toEqual(["no uses"]);
    const asJson = await runVaultCli({ action: "report", json: true }, config(daemon.port));
    expect(asJson.out).toEqual([JSON.stringify({ rows: [] }, null, 2)]);
  });
});

describe("flightdeckd vault rules (issue #3458)", () => {
  test("it prints the tags of the secret and one line per rule", async () => {
    const rule = { id: "r1", requesters: ["claude"], decision: "allow" };
    const daemon = fakeDaemon({
      "vault.rules.get": () => ({ secretId: "db-pass", tags: ["prod", "db"], rules: [rule] }),
    });
    const result = await runVaultCli({ action: "rules", secretId: "db-pass" }, config(daemon.port));
    expect(calls(daemon, "vault.rules.get")).toEqual([
      { type: "vault.rules.get", payload: { secretId: "db-pass" } },
    ]);
    expect(result.out).toEqual(["tags: prod, db", `rule 1: ${JSON.stringify(rule)}`]);
  });

  test("a secret with no tags and no rules says so", async () => {
    const daemon = fakeDaemon({
      "vault.rules.get": () => ({ secretId: "s", tags: [], rules: [] }),
    });
    const result = await runVaultCli({ action: "rules", secretId: "s" }, config(daemon.port));
    expect(result.out).toEqual(["tags: (none)", "no rules"]);
  });

  test("--json prints the daemon's answer", async () => {
    const answer = { secretId: "s", tags: ["a"], rules: [] };
    const daemon = fakeDaemon({ "vault.rules.get": () => answer });
    const result = await runVaultCli(
      { action: "rules", secretId: "s", json: true },
      config(daemon.port),
    );
    expect(result.out).toEqual([JSON.stringify(answer, null, 2)]);
  });
});

describe("flightdeckd vault rules preview (issue #3458)", () => {
  test("it sends the use as typed and prints the verdict, and records nothing", async () => {
    const daemon = fakeDaemon({
      "vault.rules.preview": () => verdict({ decision: "allow", ruleId: "r1", reason: "by r1" }),
    });
    const result = await runVaultCli(
      {
        action: "preview",
        secretId: "db-pass",
        requester: "claude",
        purpose: "action",
        useAction: "deploy",
        host: "pi",
        project: "api",
        session: "s1",
        tags: ["prod"],
        risk: "high",
        approval: "never",
        at: 1_790_000_000_000,
      },
      config(daemon.port),
    );
    expect(result.out).toEqual(["allow by rule r1: by r1"]);
    expect(daemon.calls.map((c) => c.type)).toEqual(["hello", "vault.rules.preview"]);
    expect(calls(daemon, "vault.rules.preview")[0]?.payload).toEqual({
      secretId: "db-pass",
      requester: "claude",
      purpose: "action",
      action: "deploy",
      host: "pi",
      project: "api",
      session: "s1",
      tags: ["prod"],
      risk: "high",
      actionApproval: "never",
      at: 1_790_000_000_000,
    });
  });

  test("what was not typed is not sent", async () => {
    const daemon = fakeDaemon({ "vault.rules.preview": () => verdict() });
    await runVaultCli(
      { action: "preview", secretId: "s", requester: "you", purpose: "ssh" },
      config(daemon.port),
    );
    expect(calls(daemon, "vault.rules.preview")[0]?.payload).toEqual({
      secretId: "s",
      requester: "you",
      purpose: "ssh",
    });
  });

  test("the verdict says when it is the default, once, held or limited", async () => {
    const daemon = fakeDaemon({
      "vault.rules.preview": () =>
        verdict({ decision: "ask", once: true, needsHold: true, limited: true }),
    });
    const result = await runVaultCli(
      { action: "preview", secretId: "s", requester: "claude", purpose: "ssh" },
      config(daemon.port),
    );
    expect(result.out).toEqual([
      "ask by default: no rule covers this use [once per session] [approval must be held 2 s] [limit reached]",
    ]);
  });

  test("--json prints the verdict", async () => {
    const daemon = fakeDaemon({ "vault.rules.preview": () => verdict() });
    const result = await runVaultCli(
      { action: "preview", secretId: "s", requester: "you", purpose: "ssh", json: true },
      config(daemon.port),
    );
    expect(result.out).toEqual([JSON.stringify(verdict(), null, 2)]);
  });
});

describe("the arguments of vault (issue #3458)", () => {
  test("decisions takes an optional secret, --days, --limit and --json", () => {
    expect(parsed(["vault", "decisions"])).toMatchObject({
      command: "vault",
      action: "decisions",
    });
    expect(
      parsed(["vault", "decisions", "db-pass", "--days", "7", "--limit", "20", "--json"]),
    ).toMatchObject({
      action: "decisions",
      secretId: "db-pass",
      days: 7,
      limit: 20,
      json: true,
    });
    expect(parsed(["vault", "decisions", "--days", "7"])).toMatchObject({ days: 7 });
  });

  test("report takes --days, --csv and --json", () => {
    expect(parsed(["vault", "report", "--days", "30", "--csv"])).toMatchObject({
      command: "vault",
      action: "report",
      days: 30,
      csv: true,
    });
    expect(parsed(["vault", "report", "--json"])).toMatchObject({ action: "report", json: true });
  });

  test("rules takes the secret, and rules preview takes the use", () => {
    expect(parsed(["vault", "rules", "db-pass", "--json"])).toMatchObject({
      command: "vault",
      action: "rules",
      secretId: "db-pass",
      json: true,
    });
    expect(
      parsed([
        "vault",
        "rules",
        "preview",
        "db-pass",
        "--requester",
        "claude",
        "--purpose",
        "action",
        "--action",
        "deploy",
        "--host",
        "pi",
        "--project",
        "api",
        "--session",
        "s1",
        "--tag",
        "prod",
        "--tag",
        "db",
        "--risk",
        "high",
        "--approval",
        "never",
        "--at",
        "2026-11-20T03:00:00Z",
      ]),
    ).toMatchObject({
      command: "vault",
      action: "preview",
      secretId: "db-pass",
      requester: "claude",
      purpose: "action",
      useAction: "deploy",
      host: "pi",
      project: "api",
      session: "s1",
      tags: ["prod", "db"],
      risk: "high",
      approval: "never",
      at: Date.parse("2026-11-20T03:00:00Z"),
    });
  });

  test("a verb, a secret or a word it does not know is refused", () => {
    expect(parsed(["vault"])).toMatchObject({
      refusedWith: expect.stringContaining("invalid vault action"),
    });
    expect(parsed(["vault", "deliver"])).toMatchObject({
      refusedWith: expect.stringContaining("invalid vault action"),
    });
    expect(parsed(["vault", "rules"])).toMatchObject({
      refusedWith: expect.stringContaining("missing the secret"),
    });
    expect(parsed(["vault", "rules", "preview", "--requester", "you"])).toMatchObject({
      refusedWith: expect.stringContaining("missing the secret"),
    });
  });

  test("a preview needs the requester and the purpose, from the words the protocol has", () => {
    expect(parsed(["vault", "rules", "preview", "s", "--purpose", "ssh"])).toMatchObject({
      refusedWith: expect.stringContaining("--requester: needed"),
    });
    expect(parsed(["vault", "rules", "preview", "s", "--requester", "you"])).toMatchObject({
      refusedWith: expect.stringContaining("--purpose: needed"),
    });
    const bad: Array<[string[], string]> = [
      [
        ["--requester", "bob", "--purpose", "ssh"],
        "--requester: you, claude, automation or workflow",
      ],
      [["--requester", "you", "--purpose", "mail"], "--purpose: ssh, action or run_with_secret"],
      [["--requester", "you", "--purpose", "ssh", "--risk", "x"], "--risk: low, medium or high"],
      [
        ["--requester", "you", "--purpose", "ssh", "--approval", "x"],
        "--approval: always, never or first-per-session",
      ],
      [["--requester", "you", "--purpose", "ssh", "--at", "noon"], "--at: a date and time"],
      // Loose text that Date.parse reads anyway, or a time with no zone, would give another verdict than meant.
      [["--requester", "you", "--purpose", "ssh", "--at", "5"], "--at: a date and time"],
      [["--requester", "you", "--purpose", "ssh", "--at", "2026-11-20"], "--at: a date and time"],
      [
        ["--requester", "you", "--purpose", "ssh", "--at", "2026-11-20T03:00"],
        "--at: a date and time",
      ],
    ];
    for (const [flags, message] of bad)
      expect(parsed(["vault", "rules", "preview", "s", ...flags])).toMatchObject({
        refusedWith: expect.stringContaining(message),
      });
  });

  test("--days is a whole number from 1 to 365", () => {
    for (const days of ["0", "366", "x", "1.5"])
      expect(parsed(["vault", "report", "--days", days])).toMatchObject({
        refusedWith: expect.stringContaining("--days: a whole number from 1 to 365"),
      });
  });

  test("a flag of one verb is refused on the others", () => {
    const refused: Array<[string[], string]> = [
      [["vault", "decisions", "--csv"], "--csv"],
      [["vault", "rules", "s", "--days", "7"], "--days"],
      [["vault", "rules", "s", "--limit", "7"], "--limit"],
      [["vault", "report", "--limit", "7"], "--limit"],
      [["vault", "report", "--host", "pi"], "--host"],
      [["vault", "decisions", "--session", "s"], "--session"],
      [["vault", "decisions", "--project", "p"], "--project"],
      [["vault", "decisions", "--requester", "you"], "--requester"],
      [["vault", "report", "--tag", "x"], "--tag"],
      [["vault", "rules", "s", "--at", "2026-11-20T03:00:00Z"], "--at"],
      [["vault", "rules", "preview", "s", "--days", "7"], "--days"],
    ];
    for (const [argv, flag] of refused)
      expect(parsed(argv)).toMatchObject({
        refusedWith: expect.stringContaining(`${flag}: this flag only applies`),
      });
  });

  test("the flags of vault are refused on the other commands", () => {
    const valid: Array<[string, string]> = [
      ["--days", "7"],
      ["--requester", "you"],
      ["--purpose", "ssh"],
      ["--action", "deploy"],
      ["--tag", "prod"],
      ["--risk", "low"],
      ["--approval", "never"],
      ["--at", "2026-11-20T03:00:00Z"],
    ];
    for (const [flag, value] of valid)
      expect(parsed(["card", "list", flag, value])).toMatchObject({
        refusedWith: expect.stringContaining(
          `${flag}: this flag only applies to flightdeckd vault`,
        ),
      });
    expect(parsed(["card", "list", "--csv"])).toMatchObject({
      refusedWith: expect.stringContaining("--csv: this flag only applies to flightdeckd vault"),
    });
  });

  test("--host, --session, --limit and --json keep their other owners", () => {
    expect(parsed(["requests", "--session", "s1"])).toMatchObject({ session: "s1" });
    expect(parsed(["sessions", "--host", "pi"])).toMatchObject({ host: "pi" });
    expect(parsed(["autoapprove", "list", "--limit", "5"])).toMatchObject({ limit: 5 });
    expect(parsed(["history", "list", "--limit", "5", "--json"])).toMatchObject({ json: true });
    expect(parsed(["card", "list", "--host", "pi"])).toMatchObject({
      refusedWith: expect.stringContaining("--host: this flag only applies to flightdeckd host"),
    });
  });
});

describe("vault through the command line (issue #3458)", () => {
  test("decisions runs through flightdeckd", async () => {
    const daemon = fakeDaemon({ "vault.decisions": () => ({ decisions: [decision("d1")] }) });
    const run = await flightdeckd(["vault", "decisions", "db-pass", "--days", "7"], daemon.port);
    expect(run.out).toEqual([
      "2026-11-20T10:00:00.000Z  db-pass  claude  action deploy on pi  allow/allowed (rule)  a rule lets claude deploy",
    ]);
    expect(calls(daemon, "vault.decisions")[0]?.payload).toEqual({
      secretId: "db-pass",
      days: 7,
    });
  });

  test("preview runs through flightdeckd, and a refusal exits 1", async () => {
    const daemon = fakeDaemon({
      "vault.rules.preview": () => ({ error: { code: "not_found", message: "no such secret" } }),
    });
    const run = await flightdeckd(
      ["vault", "rules", "preview", "nope", "--requester", "you", "--purpose", "ssh"],
      daemon.port,
    );
    expect(run.code).toBe(1);
    expect(run.err.join("\n")).toContain("not_found: no such secret");
  });

  test("no daemon exits 2 with one line", async () => {
    const run = await flightdeckd(["vault", "report"], 1);
    expect(run.code).toBe(2);
    expect(run.err).toHaveLength(1);
  });
});
