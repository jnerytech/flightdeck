import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { EventStore } from "../src/store/event-store.ts";
import { tempDir } from "./helpers.ts";

const stores: EventStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.db.close();
});

const open = (path: string) => {
  const store = new EventStore(path);
  stores.push(store);
  return store;
};

/** The value of a pragma (busy_timeout names its column `timeout`, so the first one is taken). */
const pragma = (store: EventStore, name: string) =>
  Object.values(store.db.query(`PRAGMA ${name}`).get() as Record<string, unknown>)[0];

describe("sqlite-durability: the daemon's database trades the last events of a power cut for write speed", () => {
  test("a fresh store keeps the write-ahead log and syncs at checkpoints only (synchronous = NORMAL)", () => {
    const store = open(join(tempDir("fd-sqlite-"), "flightdeck.db"));
    expect(pragma(store, "journal_mode")).toBe("wal");
    // 0 = OFF, 1 = NORMAL, 2 = FULL (SQLite's default).
    expect(pragma(store, "synchronous")).toBe(1);
  });

  test("the rest of the setup stays as it was: foreign keys on, a busy timeout of 5 s", () => {
    const store = open(join(tempDir("fd-sqlite-"), "flightdeck.db"));
    expect(pragma(store, "foreign_keys")).toBe(1);
    expect(pragma(store, "busy_timeout")).toBe(5000);
  });
});
