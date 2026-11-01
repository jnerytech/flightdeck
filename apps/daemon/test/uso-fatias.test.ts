import { describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { UsageIndexer } from "../src/costs/usage-indexer.ts";
import { EventStore } from "../src/store/event-store.ts";
import { tempDir } from "./helpers.ts";
import { usageEntries, usageFixture, writeUsageTranscript } from "./usage-helpers.ts";

const CWD = "/work/app";

/** One transcript of about 58 KB: twelve copies of the fixture, each with its own message ids. */
function bigTranscript() {
  const root = join(tempDir("fd-fatias-"), "projects");
  mkdirSync(root);
  const { main } = writeUsageTranscript(root, "p", CWD, {
    id: "s-big",
    prefix: "0",
    subagent: false,
  });
  for (let i = 1; i < 12; i++)
    appendFileSync(main, usageFixture("usage-main.jsonl", CWD, String(i)));
  return { root, main };
}

function indexer(root: string, extra: { sliceBytes?: number; pause?: () => Promise<void> } = {}) {
  const store = new EventStore(":memory:");
  return {
    db: store.db,
    indexer: new UsageIndexer({
      db: store.db,
      roots: [root],
      projectKey: (cwd) => `k:${basename(cwd)}`,
      ...extra,
    }),
  };
}

describe("uso-fatias: a big transcript is read in slices, with the event loop given back between them", () => {
  test("a pass reads at most one slice of a file at a time, and ends with the same entries as a whole read", async () => {
    const { root, main } = bigTranscript();
    expect(statSync(main).size).toBeGreaterThan(50_000);
    let pauses = 0;
    const sliced = indexer(root, {
      sliceBytes: 8192,
      pause: async () => {
        pauses++;
      },
    });
    const whole = indexer(root);
    const added = await sliced.indexer.pass();
    await whole.indexer.pass();
    // 58 KB in slices of 8 KB is at least seven reads, each followed by a pause.
    expect(pauses).toBeGreaterThanOrEqual(7);
    expect(added).toBeGreaterThan(0);
    expect(usageEntries(sliced.db)).toEqual(usageEntries(whole.db));
  });

  test("a line bigger than a slice is read whole instead of stalling the file", async () => {
    const root = join(tempDir("fd-fatias-"), "projects");
    mkdirSync(root);
    const { main } = writeUsageTranscript(root, "p", CWD, { id: "s-line", subagent: false });
    const { indexer: index, db } = indexer(root, { sliceBytes: 64 });
    await index.pass();
    expect(usageEntries(db).length).toBeGreaterThan(0);
    expect(statSync(main).size).toBeGreaterThan(64);
  });
});
