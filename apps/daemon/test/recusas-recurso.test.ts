import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DAEMON_FEATURES } from "@flightdeck/protocol";
import { GATES } from "../src/server/gates.ts";
import { startServer } from "../src/server.ts";
import { newManager } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "recurso-token-0123456789";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** A daemon with none of the optional parts: every command that needs one finds it off. */
async function bare() {
  const { manager, root } = newManager();
  const server = startServer({
    manager,
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [root],
  });
  cleanups.push(() => server.stop());
  const client = new FrameClient(server.url);
  cleanups.push(() => client.close());
  await client.request("hello", { token: TOKEN, client: "t" });
  return client;
}

describe("recusas-recurso: a command whose part is off says which feature, as a reason", () => {
  const cases: Array<[string, string, object]> = [
    ["history.list", "history", {}],
    ["memory.list", "memory", { projectId: "p" }],
    ["costs.status", "costs", {}],
    ["budget.list", "budgets", {}],
    ["snippets.list", "snippets", {}],
    ["personas.list", "personas", {}],
    ["teams.list", "teams", {}],
    ["actions.list", "actions", {}],
    ["automation.list", "automations", { projectId: "p" }],
    ["issues.list", "issues", { projectId: "p" }],
    ["ssh.list", "ssh", {}],
    ["daemon.update.apply", "updater", {}],
    ["daemon.shutdown", "shutdown", {}],
  ];
  for (const [command, feature, payload] of cases) {
    test(`${command} on a host without it: feature_off, ${feature}, in English`, async () => {
      const client = await bare();
      const answer = await client.request(command, payload);
      expect(answer.error).toMatchObject({
        code: "invalid_state",
        reason: "feature_off",
        params: { feature },
      });
      expect((answer.error as { message: string }).message).not.toMatch(/[À-ú]/);
    });
  }

  test("the server uses only listed features, and every listed feature is used", () => {
    // Issue #248: the names live in server.ts, in its handler modules and in the gate table.
    const dir = resolve(import.meta.dir, "../src/server");
    const files = [
      resolve(import.meta.dir, "../src/server.ts"),
      ...readdirSync(dir, { recursive: true })
        .map(String)
        .filter((f) => f.endsWith(".ts"))
        .map((f) => resolve(dir, f)),
    ];
    const source = files.map((f) => readFileSync(f, "utf8")).join("\n");
    const used = new Set([
      ...[...source.matchAll(/featureOff\("(\w+)"\)/g)].map((m) => m[1]),
      ...Object.values(GATES).filter((feature) => /^\w+$/.test(feature)),
    ]);
    expect(used.size).toBeGreaterThan(30);
    expect([...used].sort()).toEqual([...(DAEMON_FEATURES as readonly string[])].sort());
  });
});
