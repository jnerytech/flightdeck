import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CliResult } from "../../src/daemon-client/index.ts";
import { runMessageAdminCli } from "../../src/messaging/message-admin-cli.ts";
import { CLOSE, config, fakeDaemon, stopAll } from "../board/card-cli-helpers.ts";
import { tempDir } from "../support/helpers.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const text = (r: CliResult) => [...r.out, ...r.err].join("\n");
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
