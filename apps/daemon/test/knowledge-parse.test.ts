import { describe, expect, test } from "bun:test";
import { parseKnowledge } from "../src/knowledge/parse.ts";

/** Issue #76: what one library document says about itself, from its front matter and its heading. */
const doc = (front: string, body = "# Title (issue #12)\n\ntext\n") =>
  `---\n${front}\n---\n${body}`;

describe("knowledge-parse: the status, type and title of one document (#76)", () => {
  test("the three statuses are read from the front matter", () => {
    const statuses = ["valid", "transitional", "obsolete"].map(
      (status) => parseKnowledge("docs/adr/a.md", doc(`status: ${status}`)).status,
    );
    expect(statuses).toEqual(["valid", "transitional", "obsolete"]);
  });

  test("no front matter is unclassified, and the title is the heading without its issue suffix", () => {
    expect(parseKnowledge("docs/decisions/x.md", "# Secret kinds (issue #815)\n\nbody\n")).toEqual({
      title: "Secret kinds",
      type: "adr",
      status: "unclassified",
      supersedes: null,
      problems: [],
    });
  });

  test("a status outside the three is unclassified and a problem, never a crash", () => {
    expect(parseKnowledge("docs/adr/a.md", doc("status: draft"))).toMatchObject({
      status: "unclassified",
      problems: ["status_unknown"],
    });
    expect(parseKnowledge("docs/adr/a.md", doc("status: [valid]"))).toMatchObject({
      status: "unclassified",
      problems: ["status_unknown"],
    });
  });

  test("a front matter that is not YAML is a problem and the heading still gives the title", () => {
    expect(parseKnowledge("docs/adr/a.md", doc("status: [valid\n  : :", "# Kept\n"))).toMatchObject(
      {
        title: "Kept",
        status: "unclassified",
        problems: ["frontmatter_invalid"],
      },
    );
  });

  test("title: in the front matter wins; with no heading either, the file name is the title", () => {
    expect(parseKnowledge("docs/adr/a.md", doc("title: Chosen\nstatus: valid")).title).toBe(
      "Chosen",
    );
    expect(parseKnowledge("docs/adr/my-doc.md", "no heading here\n").title).toBe("my-doc");
  });

  test("a BOM and CRLF line ends are read like plain text", () => {
    const text = "﻿---\r\nstatus: valid\r\ntype: rfc\r\n---\r\n# Windows doc\r\n";
    expect(parseKnowledge("docs/rfc/w.md", text)).toMatchObject({
      title: "Windows doc",
      type: "rfc",
      status: "valid",
    });
  });

  test("the type comes from the front matter, else from the folder; an unknown one is a problem", () => {
    const type = (path: string, front = "status: valid") => parseKnowledge(path, doc(front)).type;
    expect([
      type("docs/specs/a.md", "type: prd"),
      type("docs/adr/a.md"),
      type("docs/decisions/a.md"),
      type("docs/rfc/a.md"),
      type("docs/prd/a.md"),
      type("docs/specs/a.md"),
      type("docs/other/a.md"),
    ]).toEqual(["prd", "adr", "adr", "rfc", "prd", "spec", null]);
    expect(parseKnowledge("docs/adr/a.md", doc("type: memo"))).toMatchObject({
      type: "adr",
      problems: ["type_unknown"],
    });
  });

  test("supersedes is a project path, and anything else is a problem", () => {
    expect(
      parseKnowledge("docs/adr/a.md", doc("status: valid\nsupersedes: docs/adr/old.md")),
    ).toMatchObject({ supersedes: "docs/adr/old.md", problems: [] });
    expect(parseKnowledge("docs/adr/a.md", doc("supersedes: 12"))).toMatchObject({
      supersedes: null,
      problems: ["supersedes_invalid"],
    });
  });

  test("a heading with a phase suffix loses it too, and only the first heading counts", () => {
    expect(parseKnowledge("docs/adr/a.md", "# Phase thing (phase 7)\n# Second\n").title).toBe(
      "Phase thing",
    );
  });

  test("front matter that is a text, a number or a list is a problem, not a crash", () => {
    for (const front of ["hello", "42", "- a\n- b"]) {
      expect(parseKnowledge("docs/adr/a.md", doc(front, "# Kept\n"))).toMatchObject({
        title: "Kept",
        status: "unclassified",
        problems: ["frontmatter_invalid"],
      });
    }
  });

  test("a heading of a long run of spaces is read in linear time", () => {
    const started = Date.now();
    parseKnowledge("docs/adr/a.md", `# a${" ".repeat(30_000)}x\n`);
    parseKnowledge("docs/adr/a.md", `# a${" ".repeat(30_000)}`);
    expect(Date.now() - started < 500).toBe(true);
  });

  test("a title longer than 200 characters and a supersedes longer than 512 are cut or refused", () => {
    const parsed = parseKnowledge(
      "docs/adr/a.md",
      doc(`status: valid\nsupersedes: ${"d/".repeat(300)}x.md`, `# ${"t".repeat(5_000)}\n`),
    );
    expect([parsed.title.length, parsed.supersedes, parsed.problems]).toEqual([
      200,
      null,
      ["supersedes_invalid"],
    ]);
  });
});
