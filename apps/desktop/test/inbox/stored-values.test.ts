import { describe, expect, test } from "bun:test";
import { loadLastBoards } from "../../src/features/board/board-shortcut.ts";
import { INBOX_KEY, loadInbox } from "../../src/features/inbox/inbox.ts";
import { loadQuietSnooze, QUIET_SNOOZE_KEY } from "../../src/features/needs-you/quiet-snooze.ts";

const storageWith = (key: string, raw: string) => ({
  getItem: (asked: string) => (asked === key ? raw : null),
});

const ENTRY = {
  id: "n1",
  at: "2026-11-12T10:00:00.000Z",
  title: "Build done",
  body: "main is green",
  read: false,
};

describe("the inbox, the last boards and the quiet snoozes are parsed, not trusted (#1609)", () => {
  test("an inbox entry that is not an entry is left out and the others stay", () => {
    const raw = JSON.stringify([ENTRY, "junk", { id: 7 }, { ...ENTRY, id: "n2", read: "no" }]);
    expect(loadInbox(storageWith(INBOX_KEY, raw))).toEqual([ENTRY]);
  });

  test("an inbox that is not a list, or not JSON, is empty", () => {
    for (const raw of ['{"id":"n1"}', "not json", "null"]) {
      expect(loadInbox(storageWith(INBOX_KEY, raw))).toEqual([]);
    }
  });

  test("a last board that is not a board id is left out and the others stay", () => {
    const raw = '{"h1":"board-a","h2":7,"h3":null}';
    expect(loadLastBoards(storageWith("flightdeck.lastBoards", raw))).toEqual({ h1: "board-a" });
  });

  test("a snooze that is not a future time is left out and the running ones stay", () => {
    const raw = '{"a":2000,"b":500,"c":"soon","d":null}';
    expect(loadQuietSnooze(storageWith(QUIET_SNOOZE_KEY, raw), 1000)).toEqual({ a: 2000 });
  });
});
