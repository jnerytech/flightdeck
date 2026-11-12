import { describe, expect, test } from "bun:test";
import { INBOX_KEY, loadInbox } from "../../src/features/inbox/inbox.ts";

const storageWith = (key: string, raw: string) => ({
  getItem: (asked: string) => (asked === key ? raw : null),
  setItem: () => {},
});

const ENTRY = {
  id: "n1",
  at: "2026-11-12T10:00:00.000Z",
  title: "Build done",
  body: "main is green",
  read: false,
};

describe("the inbox is parsed, not trusted (#1609)", () => {
  test("an inbox entry that is not an entry is left out and the others stay", () => {
    const raw = JSON.stringify([ENTRY, "junk", { id: 7 }, { ...ENTRY, id: "n2", read: "no" }]);
    expect(loadInbox(storageWith(INBOX_KEY, raw))).toEqual([ENTRY]);
  });

  test("an inbox that is not a list, or not JSON, is empty", () => {
    for (const raw of ['{"id":"n1"}', "not json", "null"]) {
      expect(loadInbox(storageWith(INBOX_KEY, raw))).toEqual([]);
    }
  });
});
