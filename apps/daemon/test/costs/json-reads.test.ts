import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { Costs } from "../../src/costs/costs.ts";
import { DEFAULT_PRICING } from "../../src/costs/domain/pricing.ts";
import { readConfig } from "../../src/costs/statusline.ts";
import { UsageIndexer } from "../../src/costs/usage-indexer.ts";
import { EventStore } from "../../src/store/event-store.ts";
import { tempDir } from "../support/helpers.ts";
import { insertSession, usageEntries, writeUsageTranscript } from "../support/usage-helpers.ts";

setDefaultTimeout(30_000);

type Db = EventStore["db"];

function entry(db: Db, id: string, session: string, cost: number) {
  db.query(
    `INSERT INTO usage_entries (message_id, claude_session_id, at, day, project_key, model, origin,
       speed, input, output, cache_read, cache_write_5m, cache_write_1h, cost_usd)
     VALUES (?, ?, '2026-10-01T12:00:00.000Z', '2026-10-01', 'k', 'claude-sonnet-5-5', 'app', 'standard', 1, 1, 0, 0, 0, ?)`,
  ).run(id, session, cost);
}

function turnResult(db: Db, sessionId: string, payload: string) {
  db.query(
    "INSERT INTO events (session_id, seq, ts, type, payload) VALUES (?, 1, '2026-10-01T12:00:00.000Z', 'turn.result', ?)",
  ).run(sessionId, payload);
}

/** One indexing pass over a transcript folder, with a project key from the folder's name. */
async function passOver(root: string, db: Db, warmKeys?: (cwds: string[]) => Promise<unknown>) {
  await new UsageIndexer({
    db,
    roots: [root],
    projectKey: (cwd) => `k:${basename(cwd)}`,
    ...(warmKeys ? { warmKeys } : {}),
  }).pass();
}

describe("costs: JSON from disk and from the store is checked, not trusted (#1609)", () => {
  test("a statusline config that is not JSON reads as no config, as its doc says", async () => {
    const file = join(tempDir("fd-costs-json-"), "config.json");
    writeFileSync(file, "{ not json");
    expect(await readConfig(file)).toBeNull();
  });

  test("a turn.result whose payload is damaged is skipped; the other sessions still show their divergence", () => {
    const { db } = new EventStore(":memory:");
    const costs = new Costs({ db, pricing: DEFAULT_PRICING });
    insertSession(db, "m-1", "s-broken", "/work/app");
    entry(db, "a-1", "s-broken", 5);
    turnResult(db, "m-1", "{ damaged");
    insertSession(db, "m-2", "s-far", "/work/app");
    entry(db, "b-1", "s-far", 10);
    turnResult(db, "m-2", JSON.stringify({ type: "turn.result", costUsd: 20 }));
    expect(costs.status().divergences.map((d) => d.claudeSessionId)).toEqual(["s-far"]);
  });

  test("a transcript line that is JSON but no object does not stop the lines after it", async () => {
    const root = join(tempDir("fd-costs-json-"), "projects");
    mkdirSync(root);
    const clean = new EventStore(":memory:").db;
    writeUsageTranscript(root, "p", "/work/app", { subagent: false });
    await passOver(root, clean);
    const expected = usageEntries(clean).length;
    const dirty = new EventStore(":memory:").db;
    const root2 = join(tempDir("fd-costs-json-"), "projects");
    mkdirSync(root2);
    const { main } = writeUsageTranscript(root2, "p", "/work/app", { subagent: false });
    appendFileSync(main, "null\n42\n[1]\n");
    await passOver(root2, dirty);
    expect(expected).toBeGreaterThan(0);
    expect(usageEntries(dirty)).toHaveLength(expected);
  });

  test("a folder name with a bad escape in a transcript does not stop the pass", async () => {
    const root = join(tempDir("fd-costs-json-"), "projects");
    mkdirSync(root);
    const { main } = writeUsageTranscript(root, "p", "/work/app", { subagent: false });
    appendFileSync(main, '{"cwd":"C:\\q\\x"}\n');
    const db = new EventStore(":memory:").db;
    const asked: string[] = [];
    await passOver(root, db, async (cwds) => void asked.push(...cwds));
    expect(asked).toContain("/work/app");
    expect(usageEntries(db).length).toBeGreaterThan(0);
  });
});
