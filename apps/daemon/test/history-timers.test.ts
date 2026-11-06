import { describe, expect, test } from "bun:test";
import { HistoryIndexer, type IndexerTimers } from "../src/history/indexer.ts";
import { EventStore } from "../src/store/event-store.ts";
import {
  assistantLine,
  projectsRoot,
  storedMessages,
  userLine,
  writeTranscript,
} from "./history-helpers.ts";

/**
 * #553: the boot pass, the fallback interval and the file watcher run on real timers and real file
 * events in the protocol test, so whether their callbacks were reached depended on the clock: the
 * whole-repo function gate once came out at 98.68%. Here the timers and the watcher are fired by
 * hand, so every callback is reached on every run.
 */

const ID = "55555555-5555-4555-8555-555555555555";
const CWD = "/home/dev/projeto-timers";
const INTERVAL_MS = 250;
const DEBOUNCE_MS = 40;

/** Timers and a watcher that fire only when the test says so. */
function manual() {
  const timeouts: Array<{ fn: () => void; ms: number }> = [];
  const intervals: Array<{ fn: () => void; ms: number }> = [];
  const events: Array<() => void> = [];
  let closed = 0;
  const timers: IndexerTimers = {
    setTimeout: (fn, ms) => {
      timeouts.push({ fn, ms });
      return timeouts.length as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: () => {},
    setInterval: (fn, ms) => {
      intervals.push({ fn, ms });
      return intervals.length as unknown as ReturnType<typeof setInterval>;
    },
    clearInterval: () => {},
  };
  const watch = (_root: string, onEvent: () => void) => {
    events.push(onEvent);
    return {
      close: () => {
        closed++;
      },
    };
  };
  return { timers, watch, timeouts, intervals, events, closed: () => closed };
}

function setup() {
  const root = projectsRoot();
  const store = new EventStore(":memory:");
  const hand = manual();
  const indexer = new HistoryIndexer({
    db: store.db,
    roots: [root],
    timers: hand.timers,
    watch: hand.watch,
    scanIntervalMs: INTERVAL_MS,
    watchDebounceMs: DEBOUNCE_MS,
  });
  writeTranscript(root, "-home-dev-projeto-timers", ID, [
    userLine({ uuid: "u1", text: "Pergunta", cwd: CWD }),
    assistantLine({ uuid: "a1", text: "Resposta", cwd: CWD }),
  ]);
  return { db: store.db, indexer, hand };
}

describe("history indexer: timers and watcher fired by hand (#553)", () => {
  test("start asks for the boot pass at once and for the fallback pass every interval", () => {
    const { indexer, hand } = setup();
    indexer.start();
    expect(hand.timeouts.map((t) => t.ms)).toEqual([0]);
    expect(hand.intervals.map((t) => t.ms)).toEqual([INTERVAL_MS]);
    expect(hand.events).toHaveLength(1);
    indexer.stop();
    expect(hand.closed()).toBe(1);
  });

  test("the boot pass indexes what is on disk", async () => {
    const { db, indexer, hand } = setup();
    indexer.start();
    expect(storedMessages(db, ID)).toEqual([]);
    hand.timeouts[0]?.fn();
    await indexer.idle();
    expect(storedMessages(db, ID).map((m) => m.uuid)).toEqual(["u1", "a1"]);
    indexer.stop();
  });

  test("the fallback interval indexes what is on disk, with no boot pass and no file event", async () => {
    const { db, indexer, hand } = setup();
    indexer.start();
    expect(storedMessages(db, ID)).toEqual([]);
    hand.intervals[0]?.fn();
    await indexer.idle();
    expect(storedMessages(db, ID).map((m) => m.uuid)).toEqual(["u1", "a1"]);
    indexer.stop();
  });

  test("file events become one pass after the debounce; once it ran, the next event schedules another", async () => {
    const { db, indexer, hand } = setup();
    indexer.start();
    const debounced = () => hand.timeouts.filter((t) => t.ms === DEBOUNCE_MS);
    expect(debounced()).toHaveLength(0);
    // A burst of events: one pass is scheduled, not three.
    hand.events[0]?.();
    hand.events[0]?.();
    hand.events[0]?.();
    expect(debounced()).toHaveLength(1);
    expect(storedMessages(db, ID)).toEqual([]);
    debounced()[0]?.fn();
    await indexer.idle();
    expect(storedMessages(db, ID).map((m) => m.uuid)).toEqual(["u1", "a1"]);
    // The pass cleared the pending mark: the next event schedules again.
    hand.events[0]?.();
    expect(debounced()).toHaveLength(2);
    indexer.stop();
  });

  test("a watcher that cannot start is logged with its reason, and the passes go on without it", () => {
    for (const [thrown, reason] of [
      [new Error("EMFILE: too many open files"), "EMFILE: too many open files"],
      ["no inotify", "no inotify"],
    ] as const) {
      const root = projectsRoot();
      const store = new EventStore(":memory:");
      const hand = manual();
      const logs: string[] = [];
      const indexer = new HistoryIndexer({
        db: store.db,
        roots: [root],
        timers: hand.timers,
        watch: () => {
          throw thrown;
        },
        log: (line) => logs.push(line),
      });
      indexer.start();
      expect(logs).toContain(`histórico: sem observação de ${root} (${reason})`);
      // The boot pass and the fallback interval are still asked for.
      expect(hand.timeouts).toHaveLength(1);
      expect(hand.intervals).toHaveLength(1);
      indexer.stop();
    }
  });

  test("onChange hands back a way to stop listening", async () => {
    const { indexer } = setup();
    const heard: string[] = [];
    const stop = indexer.onChange((change) => heard.push(change.claudeSessionId));
    await indexer.scan();
    expect(heard).toEqual([ID]);
    stop();
    stop();
  });
});
