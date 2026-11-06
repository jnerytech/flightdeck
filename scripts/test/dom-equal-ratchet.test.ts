import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { domEqualCounts, domEqualities, holdsElement } from "../lib/dom-equal-ratchet.ts";
import { overBaseline } from "../lib/layout-ratchet.ts";
import { realTempDir } from "./temp-dir.ts";

const ROOT = resolve(import.meta.dir, "../..");
const BASELINE = resolve(ROOT, "dom-equal-baseline.json");
/** Built at run time so this file's own text holds no assertion for the scan to find. */
const expectOf = (actual: string, matcher: string, expected: string) =>
  `${"expect"}(${actual}).${matcher}(${expected});`;

describe("dom-equal-ratchet: no DOM element inside a deep equality", () => {
  test("a query whose element itself is compared counts, in a literal, an object or alone", () => {
    expect(holdsElement('[tool, within(tile).queryByRole("group", { name: "Request" })]')).toBe(
      true,
    );
    expect(holdsElement('{ row: screen.getByText("vps") }')).toBe(true);
    expect(holdsElement('screen.getAllByRole("row")[0]')).toBe(true);
    expect(holdsElement('card.querySelector("meter")!')).toBe(true);
    expect(holdsElement("document.activeElement")).toBe(true);
    expect(holdsElement('[[a, el.closest("label")]]')).toBe(true);
  });

  test("what is read from an element is fine: a property, a comparison, a mapped list", () => {
    expect(holdsElement('within(g).queryByRole("checkbox", { name }) !== null')).toBe(false);
    expect(
      holdsElement('[...chart.querySelectorAll("[data-day]")].map((l) => l.textContent)'),
    ).toBe(false);
    expect(holdsElement('el.closest("label")?.getAttribute("title")')).toBe(false);
    expect(holdsElement("document.activeElement?.id")).toBe(false);
    // A query's name inside a string is text, not a call.
    expect(holdsElement('[name, "getByRole(", `getByText(`]')).toBe(false);
    expect(holdsElement("rows.length")).toBe(false);
  });

  test("it counts toEqual, toStrictEqual and toMatchObject (also .not), on either side; toBe is not deep", () => {
    const source = [
      expectOf('[tool, queryByRole("group")]', "toEqual", "[tool, null]"),
      expectOf("value", "not.toStrictEqual", 'screen.getByRole("button")'),
      expectOf('{ el: getByText("x") }', "toMatchObject", "{}"),
      expectOf('getByRole("button")', "toBe", "button"),
      expectOf('getByRole("button").textContent', "toEqual", '"Approve"'),
      `// ${expectOf('getByRole("x")', "toEqual", "null")} in a comment still reads as code`,
    ].join("\n");
    expect(domEqualities(source)).toBe(4);
  });

  test("a comment inside the arguments is skipped, and a source cut short counts nothing", () => {
    expect(
      domEqualities(expectOf('getByRole("x", /* by name */ { name: "a" })', "toEqual", "null")),
    ).toBe(1);
    expect(domEqualities(`${"expect"}(getByRole("x" /* cut`)).toBe(0);
    expect(domEqualities(`${"expect"}([getByRole("x")`)).toBe(0);
  });

  test("the counts walk a folder of test sources and leave out files at zero", () => {
    const dir = realTempDir("fd-dom-equal-");
    mkdirSync(join(dir, "test", "ui"), { recursive: true });
    writeFileSync(
      join(dir, "test", "ui", "a.test.tsx"),
      expectOf('getByRole("x")', "toEqual", "null"),
    );
    writeFileSync(join(dir, "test", "b.test.ts"), expectOf("1", "toEqual", "1"));
    writeFileSync(join(dir, "test", "notes.md"), expectOf('getByRole("x")', "toEqual", "null"));
    expect(domEqualCounts(join(dir, "test"), dir)).toEqual({ "test/ui/a.test.tsx": 1 });
  });

  test("no test file compares a DOM element itself (the baseline is empty)", async () => {
    const baseline = (await Bun.file(BASELINE).json()) as Record<string, number>;
    const counts = {
      ...domEqualCounts(resolve(ROOT, "apps/desktop/test"), ROOT),
      ...domEqualCounts(resolve(ROOT, "apps/daemon/test"), ROOT),
    };
    expect(overBaseline(counts, baseline)).toEqual([]);
    // The baseline is empty: no test compares an element itself any more.
    expect(baseline).toEqual({});
  });
});
