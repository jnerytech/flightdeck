import { describe, expect, test } from "bun:test";
import { type InboxEntry, restoreEntries } from "../../src/features/inbox/domain/inbox.ts";

const entry = (id: string, read = false): InboxEntry => ({
  id,
  at: "2026-11-22T10:00:00.000Z",
  title: `n${id}`,
  body: "",
  read,
});

describe("restoring what a Clear dropped (#3898)", () => {
  test("the cleared entries come back with their read state, behind the newer ones", () => {
    const back = restoreEntries([entry("9")], [entry("1"), entry("2", true)]);
    expect(back.map((e) => `${e.id}:${e.read}`)).toEqual(["9:false", "1:false", "2:true"]);
  });

  test("an id is kept once, and the cap holds", () => {
    expect(restoreEntries([entry("1")], [entry("1"), entry("2")]).map((e) => e.id)).toEqual([
      "1",
      "2",
    ]);
    expect(restoreEntries([entry("9")], [entry("1"), entry("2")], 2).map((e) => e.id)).toEqual([
      "9",
      "1",
    ]);
  });
});
