import { describe, expect, test } from "bun:test";
import type { KnowledgeEntry } from "@flightdeck/protocol";
import { feedIndex } from "../src/knowledge/feed.ts";
import { withStatus } from "../src/knowledge/status.ts";

/** #197: Sonar S5843 and S5869 on two knowledge patterns. What each answers, pinned before it was rewritten. */

const doc = (line: string) => `---\n${line}\n---\nbody\n`;

describe("knowledge status line: the only shape rewritten is one plain word", () => {
  test("a bare, double-quoted or single-quoted word, with or without a comment, is rewritten", () => {
    const lines = [
      "status: draft",
      'status: "draft"',
      "status: 'draft'",
      "status:\tdraft",
      "status :  draft  # old",
      'status: "draft" #old',
    ];
    expect(lines.map((line) => withStatus(doc(line), "valid"))).toEqual([
      doc("status: valid"),
      doc("status: valid"),
      doc("status: valid"),
      doc("status:\tvalid"),
      doc("status :  valid  # old"),
      doc("status: valid #old"),
    ]);
  });

  test("a word with a stray or mismatched quote, a digit or a space is left alone", () => {
    const lines = [
      'status: draft"',
      "status: draft'",
      "status: draft2",
      'status: "draft2"',
      "status: draft-2",
      "status: two words",
    ];
    expect(lines.map((line) => withStatus(doc(line), "valid"))).toEqual(lines.map(() => null));
  });
});

describe("knowledge feed: which paths are given", () => {
  const entry = (path: string): KnowledgeEntry => ({
    path,
    title: "T",
    type: null,
    status: "valid",
    supersedes: null,
    bytes: 10,
    changedAt: "2026-01-01T00:00:00.000Z",
    problems: [],
    warnings: [],
    hash: "h",
  });
  const fed = (path: string) => feedIndex([entry(path)]).fed;

  test("a library folder is matched whatever its case, and plain characters are enough", () => {
    expect([
      fed("docs/decisions/a.md"),
      fed("docs/ADR/Upper Case-1_2.MD"),
      fed("docs/specs/sub/dir/x.v2.md"),
    ]).toEqual([1, 1, 1]);
  });

  test("another folder, a hidden mark, a quote or a colon is not given", () => {
    expect([
      fed("docs/other/a.md"),
      fed("docs/decisions/a.txt"),
      fed("docs/decisions/a:b.md"),
      fed('docs/decisions/a"b.md'),
      fed("docs/decisions/a‮b.md"),
      fed("docs/decisions.md"),
    ]).toEqual([0, 0, 0, 0, 0, 0]);
  });
});
