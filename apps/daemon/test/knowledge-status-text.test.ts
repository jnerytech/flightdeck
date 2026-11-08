import { describe, expect, test } from "bun:test";
import { withStatus } from "../src/knowledge/status.ts";

/** Issue #76: the text of a document with its front matter saying a status, and nothing else changed. */
describe("knowledge-status-text: only the status line moves (#76)", () => {
  test("a status line is given the new value, and every other byte stays", () => {
    const text = "---\ntitle: T\nstatus: transitional\ntype: adr\n---\n# Heading\n\nBody\n";
    expect(withStatus(text, "valid")).toBe(
      "---\ntitle: T\nstatus: valid\ntype: adr\n---\n# Heading\n\nBody\n",
    );
  });

  test("a quoted value and a trailing comment are handled: the comment stays", () => {
    expect(withStatus('---\nstatus: "valid"  # reviewed\n---\nx\n', "obsolete")).toBe(
      "---\nstatus: obsolete  # reviewed\n---\nx\n",
    );
    expect(withStatus("---\nstatus: 'valid'\n---\nx\n", "transitional")).toBe(
      "---\nstatus: transitional\n---\nx\n",
    );
  });

  test("a front matter with no status gets the line before its closing, in the file's line ending", () => {
    expect(withStatus("---\ntitle: T\n---\n# H\n", "valid")).toBe(
      "---\ntitle: T\nstatus: valid\n---\n# H\n",
    );
    expect(withStatus("---\r\ntitle: T\r\n---\r\n# H\r\n", "valid")).toBe(
      "---\r\ntitle: T\r\nstatus: valid\r\n---\r\n# H\r\n",
    );
  });

  test("a document with no front matter gets a block of the status alone", () => {
    expect(withStatus("# Plain\n\nBody\n", "valid")).toBe(
      "---\nstatus: valid\n---\n# Plain\n\nBody\n",
    );
    expect(withStatus("﻿# Plain\r\nBody\r\n", "valid")).toBe(
      "﻿---\r\nstatus: valid\r\n---\r\n# Plain\r\nBody\r\n",
    );
  });

  test("a status that is already the value changes nothing", () => {
    const text = "---\nstatus: valid\n---\nx\n";
    expect(withStatus(text, "valid")).toBe(text);
  });

  test("a front matter it cannot read with certainty is not touched: it gives null", () => {
    const unclear = [
      // never closed
      "---\nstatus: valid\n# never closed\n",
      // not a mapping
      "---\n- a\n- b\n---\nx\n",
      // two status keys
      "---\nstatus: valid\nstatus: obsolete\n---\nx\n",
      // a value on several lines, or not a plain word
      "---\nstatus: >\n  valid\n---\nx\n",
      "---\nstatus:\n  valid\n---\nx\n",
      "---\nstatus: [valid]\n---\nx\n",
      // a status key written in quotes: a second one would be a duplicate
      '---\n"status": valid\n---\nx\n',
      "---\n'status': valid\n---\nx\n",
      // not YAML at all
      "---\nstatus: valid: still\n  bad: [\n---\nx\n",
    ];
    expect(unclear.map((text) => withStatus(text, "obsolete"))).toEqual(unclear.map(() => null));
    // ...while a clear one beside them is changed.
    expect(withStatus("---\nstatus: valid\n---\nx\n", "obsolete")).toBe(
      "---\nstatus: obsolete\n---\nx\n",
    );
  });
});
