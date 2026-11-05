import { describe, expect, test } from "bun:test";
import { translator } from "../src/i18n/index.ts";
import { describeRequest, type InboxEntry, inboxRows, unreadRows } from "../src/lib/inbox.ts";

const NOW = new Date(2026, 10, 4, 15, 0, 0);
const at = (h: number, day = 4) => new Date(2026, 10, day, h, 0, 0).toISOString();
const entry = (id: string, when: string, extra: Partial<InboxEntry> = {}): InboxEntry => ({
  id,
  at: when,
  title: `t${id}`,
  body: "b",
  read: false,
  ...extra,
});
const ids = (groups: ReturnType<typeof inboxRows>) =>
  groups.map((g) => [g.section, g.rows.map((r) => r.entry.id)]);

describe("inbox-bell: what the panel draws", () => {
  test("Today then Earlier; unread rows first in each, then the newest first", () => {
    const list = [
      entry("read-new", at(14), { read: true }),
      entry("unread-old", at(9)),
      entry("unread-new", at(13)),
      entry("old-read", at(10, 2), { read: true }),
      entry("old-unread", at(8, 3)),
    ];
    expect(ids(inboxRows(list, NOW))).toEqual([
      ["today", ["unread-new", "unread-old", "read-new"]],
      ["earlier", ["old-unread", "old-read"]],
    ]);
  });

  test("a section with nothing in it is not drawn", () => {
    expect(ids(inboxRows([entry("a", at(9))], NOW))).toEqual([["today", ["a"]]]);
    expect(inboxRows([], NOW)).toEqual([]);
  });

  test("entries of one group collapse into one row with a count, the newest standing for them", () => {
    const list = [
      entry("q1", at(9), { group: "h1/s1" }),
      entry("q3", at(13), { group: "h1/s1" }),
      entry("q2", at(11), { group: "h1/s1" }),
      entry("other", at(12), { group: "h1/s2" }),
      entry("loose-a", at(10)),
      entry("loose-b", at(10)),
    ];
    const [today] = inboxRows(list, NOW);
    const rows = today?.rows.map((r) => [r.entry.id, r.count, r.ids]);
    expect(rows).toEqual([
      ["q3", 3, ["q3", "q2", "q1"]],
      ["other", 1, ["other"]],
      ["loose-a", 1, ["loose-a"]],
      ["loose-b", 1, ["loose-b"]],
    ]);
  });

  test("a read entry and an unread one of the same group are separate rows, so reading one never hides the other", () => {
    const list = [
      entry("new", at(13), { group: "g" }),
      entry("seen", at(9), { group: "g", read: true }),
    ];
    const [today] = inboxRows(list, NOW);
    expect(today?.rows.map((r) => [r.entry.id, r.count])).toEqual([
      ["new", 1],
      ["seen", 1],
    ]);
  });

  test("a group does not collapse across midnight", () => {
    const list = [entry("a", at(9), { group: "g" }), entry("b", at(9, 3), { group: "g" })];
    expect(ids(inboxRows(list, NOW))).toEqual([
      ["today", ["a"]],
      ["earlier", ["b"]],
    ]);
  });

  test("the badge is the unread rows: what shows a dot", () => {
    const list = [
      entry("q1", at(9), { group: "g" }),
      entry("q2", at(11), { group: "g" }),
      entry("x", at(12)),
      entry("seen", at(13), { read: true }),
      entry("old", at(8, 2)),
    ];
    expect(unreadRows(list, NOW)).toBe(3);
    expect(unreadRows([], NOW)).toBe(0);
  });
});

describe("inbox-bell: a request in plain words", () => {
  const en = translator("en");
  const pt = translator("pt-BR");

  test("a question says what it asks, in the first question's words", () => {
    const input = { questions: [{ question: "Which DB to use?", options: [] }, { question: "x" }] };
    expect(describeRequest("AskUserQuestion", input, en)).toBe("Asks: Which DB to use?");
    expect(describeRequest("AskUserQuestion", input, pt)).toBe("Pergunta: Which DB to use?");
  });

  test("a command says it wants to run it, cut to one short line", () => {
    expect(describeRequest("Bash", { command: "git push origin main\nsleep 1" }, en)).toBe(
      "Wants to run: git push origin main",
    );
    expect(describeRequest("Bash", { command: "x".repeat(200) }, en).length).toBeLessThan(90);
  });

  test("an edit says which file, by its name", () => {
    expect(describeRequest("Edit", { file_path: "/srv/app/src/main.ts" }, en)).toBe(
      "Wants to change main.ts",
    );
    expect(describeRequest("Write", { file_path: "C:\\work\\a.txt" }, pt)).toBe(
      "Quer alterar a.txt",
    );
  });

  test("any other tool, or a question with no text, falls back on the tool's name", () => {
    expect(describeRequest("WebFetch", { url: "https://x" }, en)).toBe("Wants to use WebFetch");
    expect(describeRequest("AskUserQuestion", {}, en)).toBe("Wants to use AskUserQuestion");
    expect(describeRequest("Bash", undefined, en)).toBe("Wants to use Bash");
  });
});
