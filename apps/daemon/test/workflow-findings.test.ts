import { describe, expect, test } from "bun:test";
import {
  BODY_MAX,
  FINDINGS_MAX_ITEMS,
  type FindingsResult,
  parseFindings,
  TITLE_MAX,
} from "../src/workflows/findings.ts";

const fence = (value: unknown) => `\`\`\`json\n${JSON.stringify(value)}\n\`\`\``;
const reply = (value: unknown) => `I found some debt.\n\n${fence(value)}\n`;
const item = (over: Record<string, unknown> = {}) => ({
  key: "debt:src/a.ts:todo",
  title: "Remove the TODO in a.ts",
  body: "src/a.ts line 4 says TODO.",
  ...over,
});

/** The refusal's `where`, or "" when the list was accepted. */
const refusedAt = (result: FindingsResult) =>
  !result.ok && result.reason === "findings_invalid" ? result.where : "";
const findings = (result: FindingsResult) => (result.ok ? result.findings : []);

describe("parseFindings (issue #79)", () => {
  test("reads the list from a fenced json block, with the text around it ignored", () => {
    const result = parseFindings(reply([item(), item({ key: "debt:b", title: "B" })]));
    expect(result.ok).toBe(true);
    expect(findings(result).map((f) => f.key)).toEqual(["debt:src/a.ts:todo", "debt:b"]);
    expect(findings(result)[0]?.title).toBe("Remove the TODO in a.ts");
  });

  test("the last block wins, so an example the agent quoted earlier does not count", () => {
    const text = `${fence([item({ key: "example" })])}\nand now the real one:\n${fence([item({ key: "real" })])}`;
    expect(findings(parseFindings(text)).map((f) => f.key)).toEqual(["real"]);
  });

  test("a reply with no json block says so, whatever else it holds", () => {
    expect(parseFindings("nothing to report")).toEqual({ ok: false, reason: "findings_missing" });
    expect(parseFindings("```\n[]\n```")).toEqual({ ok: false, reason: "findings_missing" });
  });

  test("an empty list is fine: there is nothing to raise", () => {
    expect(parseFindings(reply([]))).toEqual({ ok: true, findings: [] });
  });

  test("a block that is not json is refused, naming where", () => {
    expect(refusedAt(parseFindings("```json\n[{oops\n```"))).toBe("json");
  });

  test("a block that is not a list is refused", () => {
    expect(refusedAt(parseFindings(reply({ findings: [] })))).toBe("list");
  });

  test(`more than ${FINDINGS_MAX_ITEMS} items is refused whole, not cut`, () => {
    const many = Array.from({ length: FINDINGS_MAX_ITEMS + 1 }, (_, i) => item({ key: `k${i}` }));
    expect(refusedAt(parseFindings(reply(many)))).toBe(`more than ${FINDINGS_MAX_ITEMS} items`);
    expect(parseFindings(reply(many.slice(0, FINDINGS_MAX_ITEMS))).ok).toBe(true);
  });

  test("an item that is not an object is refused with its position", () => {
    expect(refusedAt(parseFindings(reply([item(), "text"])))).toBe("item 2");
    expect(refusedAt(parseFindings(reply([null])))).toBe("item 1");
    expect(refusedAt(parseFindings(reply([[1]])))).toBe("item 1");
  });

  test("a field the shape does not have is refused, so nothing rides along", () => {
    expect(refusedAt(parseFindings(reply([item({ command: "rm -rf /" })])))).toBe(
      "item 1, extra field",
    );
    // The name is the agent's: it is never echoed, so no invisible or endless text reaches a run's reason.
    const named = { ...item(), ["x\u202E".repeat(300)]: 1 };
    expect(refusedAt(parseFindings(reply([named])))).toBe("item 1, extra field");
  });

  test("key and title are required and must be strings", () => {
    expect(refusedAt(parseFindings(reply([{ title: "T" }])))).toBe("item 1, key");
    expect(refusedAt(parseFindings(reply([{ key: "k" }])))).toBe("item 1, title");
    expect(refusedAt(parseFindings(reply([item({ key: 7 })])))).toBe("item 1, key");
    expect(refusedAt(parseFindings(reply([item({ title: ["T"] })])))).toBe("item 1, title");
    expect(refusedAt(parseFindings(reply([item({ body: 3 })])))).toBe("item 1, body");
  });

  test("a key must be a plain id of at most 160 characters", () => {
    for (const key of ["has space", "-starts-with-dash", "line\nbreak", "", "é", "a".repeat(161)]) {
      expect(refusedAt(parseFindings(reply([item({ key })])))).toBe("item 1, key");
    }
    for (const key of ["a", "debt:src/a.ts:rule-1", "a".repeat(160), "x#1@2+3"]) {
      expect(parseFindings(reply([item({ key })])).ok).toBe(true);
    }
  });

  test(`a title has 1 to ${TITLE_MAX} characters, on one line, with nothing invisible`, () => {
    for (const title of [
      "",
      "   ",
      "x".repeat(TITLE_MAX + 1),
      "two\nlines",
      "tab\there",
      "nul\u0000",
    ]) {
      expect(refusedAt(parseFindings(reply([item({ title })])))).toBe("item 1, title");
    }
    // A right-to-left override and a zero-width space change what a person reads.
    for (const title of [
      `a${String.fromCodePoint(0x202e)}b`,
      `a${String.fromCodePoint(0x200b)}b`,
      `a${String.fromCodePoint(0x2066)}b`,
    ]) {
      expect(refusedAt(parseFindings(reply([item({ title })])))).toBe("item 1, title");
    }
    expect(findings(parseFindings(reply([item({ title: "x".repeat(TITLE_MAX) })])))).toHaveLength(
      1,
    );
  });

  test("a title is trimmed, and a missing body is empty", () => {
    const [first] = findings(parseFindings(reply([{ key: "k", title: "  Tidy up  " }])));
    expect(first).toEqual({ key: "k", title: "Tidy up", body: "" });
  });

  test(`a body has at most ${BODY_MAX} characters and keeps its lines, but no control characters`, () => {
    expect(refusedAt(parseFindings(reply([item({ body: "x".repeat(BODY_MAX + 1) })])))).toBe(
      "item 1, body",
    );
    expect(refusedAt(parseFindings(reply([item({ body: "bell\u0007" })])))).toBe("item 1, body");
    expect(
      refusedAt(parseFindings(reply([item({ body: `a${String.fromCodePoint(0x202e)}b` })]))),
    ).toBe("item 1, body");
    const body = "line one\n\tindented\r\nline three";
    expect(findings(parseFindings(reply([item({ body })])))[0]?.body).toBe(body);
    expect(parseFindings(reply([item({ body: "x".repeat(BODY_MAX) })])).ok).toBe(true);
  });

  test("one bad item refuses the whole list, so no earlier item is raised", () => {
    const result = parseFindings(reply([item(), item({ key: "k2" }), item({ key: "bad key" })]));
    expect(result.ok).toBe(false);
    expect(refusedAt(result)).toBe("item 3, key");
  });
});
