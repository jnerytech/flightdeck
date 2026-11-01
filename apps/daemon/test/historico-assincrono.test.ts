import { describe, expect, test } from "bun:test";
import { HistoryIndexer } from "../src/history/indexer.ts";
import { EventStore } from "../src/store/event-store.ts";
import {
  assistantLine,
  fileRow,
  projectsRoot,
  storedMessages,
  userLine,
  writeTranscript,
} from "./history-helpers.ts";

const CWD = "/home/dev/projeto-async";
const SMALL_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const BIG = "bbbbbbbb-0000-4000-8000-00000000000b";
const SMALL_C = "cccccccc-0000-4000-8000-00000000000c";
const SLICE = 4096;

/** About 36 KB of conversation: nine slices of 4 KB. */
function bigLines(): string[] {
  return Array.from({ length: 60 }, (_, i) =>
    i % 2 === 0
      ? userLine({ uuid: `u${i}`, text: `pergunta ${i} ${"x".repeat(500)}`, cwd: CWD })
      : assistantLine({ uuid: `a${i}`, text: `resposta ${i} ${"y".repeat(500)}`, cwd: CWD }),
  );
}

function corpus() {
  const root = projectsRoot();
  writeTranscript(root, "-p", SMALL_A, [
    userLine({ uuid: "u1", text: "oi", cwd: CWD }),
    assistantLine({ uuid: "a1", text: "olá", cwd: CWD }),
  ]);
  const big = writeTranscript(root, "-p", BIG, bigLines());
  writeTranscript(root, "-p", SMALL_C, [userLine({ uuid: "u2", text: "fim", cwd: CWD })]);
  return { root, big };
}

function indexer(root: string, extra: { pause?: () => Promise<void>; sliceBytes?: number } = {}) {
  const store = new EventStore(":memory:");
  return { store, indexer: new HistoryIndexer({ db: store.db, roots: [root], ...extra }) };
}

describe("historico-assincrono: a pass in the background does not hold the event loop", () => {
  test("it gives the loop back after every slice of every file", async () => {
    const { root } = corpus();
    let pauses = 0;
    const { indexer: index } = indexer(root, {
      sliceBytes: SLICE,
      pause: async () => {
        pauses++;
      },
    });
    await index.scanAsync();
    // 36 KB in slices of 4 KB is at least nine, plus one for each small file.
    expect(pauses).toBeGreaterThanOrEqual(11);
  });

  test("the slices add up to what a whole pass indexes, and the result names each file once", async () => {
    const { root, big } = corpus();
    const whole = indexer(root);
    const sliced = indexer(root, { sliceBytes: SLICE });
    const expected = whole.indexer.scan();
    const results = await sliced.indexer.scanAsync();
    expect(results.map((r) => [r.claudeSessionId, r.added, r.reset]).sort()).toEqual(
      expected.map((r) => [r.claudeSessionId, r.added, r.reset]).sort(),
    );
    for (const id of [SMALL_A, BIG, SMALL_C]) {
      expect(storedMessages(sliced.store.db, id)).toEqual(storedMessages(whole.store.db, id));
    }
    expect(fileRow(sliced.store.db, big)).toEqual(fileRow(whole.store.db, big));
    const sessions = (db: EventStore["db"]) =>
      db
        .query(
          "SELECT claude_session_id, title, first_ts, last_ts, message_count FROM history_sessions ORDER BY 1",
        )
        .all();
    expect(sessions(sliced.store.db)).toEqual(sessions(whole.store.db));
  });

  test("a line bigger than a slice is read whole instead of stalling the pass", async () => {
    const root = projectsRoot();
    writeTranscript(root, "-p", BIG, [
      userLine({ uuid: "u1", text: "z".repeat(20_000), cwd: CWD }),
      assistantLine({ uuid: "a1", text: "ok", cwd: CWD }),
    ]);
    const { store, indexer: index } = indexer(root, { sliceBytes: SLICE });
    const results = await index.scanAsync();
    expect(results.map((r) => r.added)).toEqual([2]);
    expect(storedMessages(store.db, BIG).map((m) => m.uuid)).toEqual(["u1", "a1"]);
  });

  test("passes asked for while one runs become one more pass, and idle waits for them", async () => {
    const { root } = corpus();
    let pauses = 0;
    const { indexer: index } = indexer(root, {
      sliceBytes: SLICE,
      pause: async () => {
        pauses++;
      },
    });
    index.request();
    index.request();
    index.request();
    await index.idle();
    const afterTwo = pauses;
    // The first pass read everything; the one asked for meanwhile found nothing new to read but
    // still walked the three files.
    expect(afterTwo).toBeGreaterThanOrEqual(11 + 3);
    index.request();
    await index.idle();
    expect(pauses).toBeGreaterThan(afterTwo);
  });
});
