import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CliResult } from "../../src/daemon-client/index.ts";
import { parseArgs } from "../../src/main.ts";
import { runMessageAdminCli } from "../../src/messaging/message-admin-cli.ts";
import { CLOSE, config, fakeDaemon, stopAll } from "../board/card-cli-helpers.ts";
import { tempDir } from "../support/helpers.ts";
import { notHigh, wrongReasons } from "../support/permissions-risk-rules.ts";

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
const stdin = (body: string) => ({ stdin: new Response(body).body as ReadableStream<Uint8Array> });
const file = (body: string): string => {
  const path = join(tempDir("fd-rules-"), "policy.json");
  writeFileSync(path, body);
  return path;
};

const POLICY = {
  exceptions: [{ id: "x", from: { team: "a" }, to: { team: "b" } }],
  loopMinutes: 5,
};

describe("flightdeckd message rules-set (issue #3622)", () => {
  test("it sends the policy file and the pairs to free, and prints the policy now in force and the pairs still paused", async () => {
    const daemon = fakeDaemon({
      "messaging.rules.set": () => ({ policy: POLICY, paused: ["s-a|s-b"] }),
    });
    const result = await runMessageAdminCli(
      { action: "rules-set", policyFile: file(JSON.stringify(POLICY)), unpause: ["s-c|s-d"] },
      config(daemon.port),
    );
    expect(result.code).toBe(0);
    expect(daemon.calls.filter((c) => c.type === "messaging.rules.set")).toEqual([
      { type: "messaging.rules.set", payload: { policy: POLICY, unpause: ["s-c|s-d"] } },
    ]);
    expect(result.out).toEqual([`policy: ${JSON.stringify(POLICY)}`, "paused pairs: s-a|s-b"]);
  });

  test("with no pair to free it sends none, and --json prints the daemon's answer", async () => {
    const answer = { policy: POLICY, paused: [] };
    const daemon = fakeDaemon({ "messaging.rules.set": () => answer });
    const result = await runMessageAdminCli(
      { action: "rules-set", policyFile: file(JSON.stringify(POLICY)), json: true },
      config(daemon.port),
    );
    expect(daemon.calls.find((c) => c.type === "messaging.rules.set")?.payload).toEqual({
      policy: POLICY,
    });
    expect(result.out).toHaveLength(1);
    expect(JSON.parse(result.out[0] ?? "")).toEqual(answer);
  });

  test("`--policy-file -` reads the policy from standard input", async () => {
    const daemon = fakeDaemon({ "messaging.rules.set": () => ({ policy: POLICY, paused: [] }) });
    const result = await runMessageAdminCli(
      { action: "rules-set", policyFile: "-" },
      config(daemon.port),
      stdin(JSON.stringify(POLICY)),
    );
    expect(result.code).toBe(0);
    expect(daemon.calls.find((c) => c.type === "messaging.rules.set")?.payload).toEqual({
      policy: POLICY,
    });
  });

  test("a policy the daemon refuses exits 1 with its reasons, and the answer is not a policy in force", async () => {
    const daemon = fakeDaemon({
      "messaging.rules.set": () => ({
        error: { code: "messaging_policy_invalid", message: "unknown field: loops" },
      }),
    });
    const result = await runMessageAdminCli(
      { action: "rules-set", policyFile: file(JSON.stringify({ loops: 1 })) },
      config(daemon.port),
    );
    expect(result.code).toBe(1);
    expect(text(result)).toContain("messaging_policy_invalid: unknown field: loops");
    expect(result.out).toEqual([]);
  });

  test("a file that is missing, is not JSON or is not an object exits 1 and asks the daemon nothing", async () => {
    const daemon = fakeDaemon({ "messaging.rules.set": () => ({ policy: POLICY, paused: [] }) });
    for (const policyFile of [
      join(tempDir("fd-rules-"), "no-such-policy.json"),
      file("{nope"),
      file("[1]"),
    ]) {
      const result = await runMessageAdminCli(
        { action: "rules-set", policyFile },
        config(daemon.port),
      );
      expect(result.code).toBe(1);
      expect(text(result)).toContain("message rules-set: cannot read a policy object from");
    }
    expect(daemon.calls.filter((c) => c.type === "messaging.rules.set")).toEqual([]);
  });

  test("a connection that closes after the write was sent exits 2 and says the rules may or may not have changed", async () => {
    const daemon = fakeDaemon({ "messaging.rules.set": () => CLOSE });
    const result = await runMessageAdminCli(
      { action: "rules-set", policyFile: file(JSON.stringify(POLICY)) },
      config(daemon.port),
    );
    expect(result.code).toBe(2);
    expect(text(result)).toContain("the rules may or may not have changed");
  });
});

describe("the arguments of message rules-set (issue #3622)", () => {
  test("it takes a policy file, the pairs to free (repeatable), --confirm, --json and --host", () => {
    expect(
      parsed([
        "message",
        "rules-set",
        "--policy-file",
        "p.json",
        "--unpause",
        "s-a|s-b",
        "--unpause",
        "s-c|s-d",
        "--confirm",
        "--json",
        "--host",
        "pi",
      ]),
    ).toMatchObject({
      command: "message",
      action: "rules-set",
      policyFile: "p.json",
      unpause: ["s-a|s-b", "s-c|s-d"],
      confirm: true,
      json: true,
      host: "pi",
    });
  });

  test("it is refused with no policy file or no --confirm", () => {
    expect(parsed(["message", "rules-set", "--confirm"])).toMatchObject({
      refusedWith: expect.stringContaining("message rules-set: missing --policy-file"),
    });
    expect(parsed(["message", "rules-set", "--policy-file", "p.json"])).toMatchObject({
      refusedWith: expect.stringContaining("message rules-set: needs --confirm"),
    });
  });

  test("its flags belong to it alone, and --confirm belongs to no other message verb", () => {
    for (const [argv, flag, owner] of [
      [["message", "rules", "--policy-file", "p.json"], "--policy-file", "message rules-set"],
      [["message", "history", "--unpause", "a|b"], "--unpause", "message rules-set"],
      [["message", "rules", "--confirm"], "--confirm", "message rules-set"],
      [["message", "send", "s-dev", "hi", "--confirm"], "--confirm", "message rules-set"],
      [
        ["message", "rules-set", "--policy-file", "p", "--confirm", "--team", "t"],
        "--team",
        "message history",
      ],
      [
        ["message", "rules-set", "--policy-file", "p", "--confirm", "--session", "s"],
        "--session",
        "message history",
      ],
    ] as const)
      expect(parsed([...argv])).toMatchObject({
        refusedWith: expect.stringContaining(
          `${flag}: this flag only applies to flightdeckd ${owner}`,
        ),
      });
  });
});

describe("risk: a session rewriting the message rules from its shell (issue #3622)", () => {
  const REASON =
    "rewrites the rules that decide which sessions may message each other, and frees paused pairs, without the person in the app; a typed --confirm is not the person (flightdeckd message rules-set)";
  const HIDDEN =
    "runs a flightdeckd command whose name, noun or verb the shell expands before it runs (a variable, a glob, a brace list or an ANSI-C quote), so the line does not say what it does";

  test("message rules-set is high, however the CLI is reached", () => {
    expect(
      wrongReasons([
        ["fd message rules-set --policy-file p.json --confirm", REASON],
        ["flightdeckd message rules-set --policy-file - --unpause a|b --confirm", REASON],
        ["fd --json message rules-set --policy-file p.json --confirm", REASON],
        ["fd --host pi message rules-set --policy-file p.json --confirm", REASON],
        ["bun run apps/daemon/src/bin.ts message rules-set --policy-file p.json", REASON],
        ['fd message "rules-set" --policy-file p.json --confirm', REASON],
        ["fd message rules --json && fd message rules-set --policy-file p.json --confirm", REASON],
        ['bash -c "fd message rules-set --policy-file p.json --confirm"', REASON],
        ["bunx flightdeckd message rules-set --policy-file p.json --confirm", REASON],
        [
          "bun run apps/daemon/src/bin.ts message --host h rules-set --policy-file p --confirm",
          REASON,
        ],
        ["bun run apps/daemon/src/bin.ts message --json rules-set --policy-file p", REASON],
        ["bunx flightdeckd message --config c.json rules-set --policy-file p --confirm", REASON],
      ]),
    ).toEqual([]);
  });

  test("the reads, a managed session's own message verbs and a word in an argument stay ordinary", () => {
    expect(
      notHigh([
        "fd message rules",
        "fd --json message rules",
        "fd message history --team t1",
        "fd message watch",
        "fd message list",
        "fd message read s-dev --last 3",
        "echo message rules-set",
        "git message rules-set",
      ]),
    ).toEqual([]);
  });

  test("a verb the shell expands is high with the reason that says why", () => {
    expect(
      wrongReasons([
        ["V=rules-set; fd message $V --policy-file p.json --confirm", HIDDEN],
        ["fd message rules-* --policy-file p.json", HIDDEN],
        ["bash -c 'fd message $V'", HIDDEN],
        ["fd message $V", HIDDEN],
      ]),
    ).toEqual([]);
  });
});
