import { describe, expect, test } from "bun:test";
import { FIELD_WORDS, MONEY_WORDS } from "../lib/no-money.ts";
import { fixedSleeps as countSleeps } from "../lib/sleep-ratchet.ts";
import { lintSpec, SECTIONS } from "../lib/spec-lint.ts";

const LIMIT_MS = 250;

/** The sleeps of a source; a `¤` stands for a letter the source must not spell, or the ratchet would count this file. */
const fixedSleeps = (source: string) => countSleeps(source.replaceAll("¤", ""));
const TABLE = "| Area | Test file | What must pass |\n|---|---|---|";

/** How long a call takes, in milliseconds. */
function took(run: () => unknown): number {
  const start = performance.now();
  run();
  return performance.now() - start;
}

/** A spec with every section; `heading` and `body` override a section's heading line and its lines. */
function spec(heading: Record<string, string> = {}, body: Record<string, string> = {}): string {
  const lines = ["# Flightdeck — Phase 40 spec (regex)"];
  for (const name of SECTIONS) {
    lines.push(heading[name] ?? `## ${name}`);
    if (name === "Tests and criteria") lines.push(TABLE);
    lines.push(body[name] ?? "");
  }
  return lines.join("\n");
}

const scenarios = (text: string) => lintSpec(spec({}, { "Acceptance scenarios": text }));

describe("sonar-regex3: spec-lint reads a section heading with the same result", () => {
  test("trailing blanks and a carriage return are not part of the name", () => {
    expect(lintSpec(spec())).toEqual([]);
    expect(lintSpec(spec({ Goal: "## Goal   ", Risks: "## Risks\r" }))).toEqual([]);
    expect(lintSpec(spec({ Goal: "## Goal \t \r" }))).toEqual([]);
    expect(lintSpec(spec({ Goal: "## Goal\u00a0" }))).toEqual([]);
  });

  test("a heading needs `## ` and some text, and the text cannot hold a line break", () => {
    expect(lintSpec(spec({ Goal: "##Goal" }))).toEqual(["missing section: ## Goal"]);
    expect(lintSpec(spec({ Goal: "### Goal" }))).toEqual(["missing section: ## Goal"]);
    expect(lintSpec(spec({ Goal: " ## Goal" }))).toEqual(["missing section: ## Goal"]);
    expect(lintSpec(spec({ Goal: "## " }))).toEqual(["missing section: ## Goal"]);
    expect(lintSpec(spec({ Goal: "##    " }))).toEqual(["missing section: ## Goal"]);
    expect(lintSpec(spec({ Risks: "## Risks\u2028x" }))).toEqual([
      "missing section: ## Risks (after ## Tests and criteria)",
    ]);
    expect(lintSpec(spec({ Risks: "## Risks x" }))).toEqual([
      "missing section: ## Risks (after ## Tests and criteria)",
    ]);
  });

  test("a blank heading still ends the section before it", () => {
    const table = `| ok-area | scripts/test/ok-area.test.ts | x |\n##   \n| BAD | x | y |`;
    expect(lintSpec(spec({}, { "Tests and criteria": table }))).toEqual([]);
  });

  test("a line of 20k blanks after a heading is read in linear time", () => {
    const blanks = " ".repeat(20_000);
    expect(took(() => lintSpec(spec({ Goal: `## Goal ${blanks}x` })))).toBeLessThan(LIMIT_MS);
    expect(took(() => lintSpec(spec({ Goal: `## Goal${blanks}\u2028x` })))).toBeLessThan(LIMIT_MS);
    expect(took(() => lintSpec(spec({ Goal: `## ${blanks}` })))).toBeLessThan(LIMIT_MS);
  });
});

describe("sonar-regex3: spec-lint counts the Feature lines with the same result", () => {
  const unnamed = (n: number) =>
    `Acceptance scenarios: ${n} Feature but 0 scripts/e2e/bdd/features/*.feature named`;

  test("a Feature at the start of a line, after any indentation, counts once", () => {
    expect(scenarios("Feature: a")).toEqual([unnamed(1)]);
    expect(scenarios("  Feature: a\n\tFeature: b\nFeature: c")).toEqual([unnamed(3)]);
    expect(scenarios("\n\n   \n  Feature: a")).toEqual([unnamed(1)]);
    expect(scenarios("Feature:Feature:")).toEqual([unnamed(1)]);
    expect(scenarios("Feature: a\r\nFeature: b")).toEqual([unnamed(2)]);
  });

  test("a Feature that is not first on its line, or is spelled differently, does not count", () => {
    expect(scenarios("a Feature: x")).toEqual([]);
    expect(scenarios("feature: x")).toEqual([]);
    expect(scenarios("Feature x")).toEqual([]);
    expect(scenarios("`Feature:` in code")).toEqual([]);
    expect(scenarios("")).toEqual([]);
  });

  test("a carriage return or a separator also starts a line", () => {
    expect(scenarios("a\rFeature: x")).toEqual([unnamed(1)]);
    expect(scenarios("a\u2028Feature: x")).toEqual([unnamed(1)]);
    expect(scenarios("a\u2029 Feature: x")).toEqual([unnamed(1)]);
    expect(scenarios("a\r\rFeature: x\rFeature: y")).toEqual([unnamed(2)]);
  });

  test("a named .feature file covers the Feature", () => {
    const text = "Feature: a\n`scripts/e2e/bdd/features/a.feature`";
    expect(scenarios(text)).toEqual([]);
    expect(scenarios(`Feature: a\nFeature: b\n${text.split("\n")[1]}`)).toEqual([
      "Acceptance scenarios: 2 Feature but 1 scripts/e2e/bdd/features/*.feature named",
    ]);
  });

  test("20k characters of blank lines are counted in linear time", () => {
    expect(took(() => scenarios("\n".repeat(20_000)))).toBeLessThan(LIMIT_MS);
    expect(took(() => scenarios(" \n".repeat(10_000)))).toBeLessThan(LIMIT_MS);
    expect(took(() => scenarios("\r".repeat(20_000)))).toBeLessThan(LIMIT_MS);
    expect(took(() => scenarios(`${"\n".repeat(20_000)}Feature: x`))).toBeLessThan(LIMIT_MS);
  });
});

describe("sonar-regex3: fixedSleeps finds a promise on a timer with the same result", () => {
  test("the arrow parameter may be bare, wrapped, spaced or typed with a generic", () => {
    expect(fixedSleeps("new Pro¤mise((r) => setTimeout(r, 5))")).toBe(1);
    expect(fixedSleeps("new Pro¤mise(r => setTimeout(r, 5))")).toBe(1);
    expect(fixedSleeps("new Pro¤mise( ( r ) => setTimeout(r, 5))")).toBe(1);
    expect(fixedSleeps("new Pro¤mise<void>((resolve) => setTimeout(resolve, 5))")).toBe(1);
    expect(fixedSleeps("new Pro¤mise<void>(\n  (r)\n  =>\n  setTimeout(r, 5))")).toBe(1);
    expect(fixedSleeps("new Pro¤mise((_r) => {\n  setTimeout(_r, 5);\n})")).toBe(1);
    expect(fixedSleeps("new Pro¤mise(r => { globalThis.setTimeout(r, 5) })")).toBe(1);
    expect(fixedSleeps("new Pro¤mise(r => window.setTimeout(r, 5))")).toBe(1);
    expect(fixedSleeps("new Pro¤mise<<x>(r => setTimeout(r, 5))")).toBe(1);
    expect(fixedSleeps("new Pro¤mise<new Pro¤mise<x>(r => setTimeout(r, 5))")).toBe(1);
    expect(fixedSleeps("new Pro¤mise<a><b>(r => setTimeout(r, 5))")).toBe(0);
  });

  test("a promise that is not a plain timer, or a different shape, is not a sleep", () => {
    expect(fixedSleeps("new Pro¤mise((resolve, reject) => setTimeout(resolve, 5))")).toBe(0);
    expect(fixedSleeps("new Pro¤mise(function (r) { setTimeout(r, 5) })")).toBe(0);
    expect(fixedSleeps("new Pro¤mise(() => setTimeout(f, 5))")).toBe(0);
    expect(fixedSleeps("new Pro¤mise((r) => other.setTimeout(r, 5))")).toBe(0);
    expect(fixedSleeps("new Pro¤mise<Array<string>>((r) => setTimeout(r, 5))")).toBe(0);
    expect(fixedSleeps("new Pro¤mise<void(r => setTimeout(r, 5))")).toBe(0);
    expect(fixedSleeps("new Pro¤mise (r => setTimeout(r, 5))")).toBe(0);
    expect(fixedSleeps("new Pro¤mise((r) => { work(); setTimeout(r, 5) })")).toBe(0);
    expect(fixedSleeps("new Pro¤mise(r => {{ setTimeout(r, 5) })")).toBe(0);
    expect(fixedSleeps("new Pro¤mise((r => setTimeout(r, 5))")).toBe(1);
    expect(fixedSleeps("new Pro¤mise(r) => setTimeout(r, 5)")).toBe(1);
    expect(fixedSleeps("new Pro¤mise")).toBe(0);
  });

  test("two of them on a line count twice", () => {
    expect(
      fixedSleeps("[new Pro¤mise(a => setTimeout(a, 1)), new Pro¤mise(b => setTimeout(b, 2))]"),
    ).toBe(2);
  });

  test("a promise opener followed by 20k blanks is scanned in linear time", () => {
    const blanks = " ".repeat(20_000);
    expect(took(() => fixedSleeps(`new Pro¤mise(${blanks}`))).toBeLessThan(LIMIT_MS);
    expect(took(() => fixedSleeps(`new Pro¤mise((${blanks}`))).toBeLessThan(LIMIT_MS);
    expect(took(() => fixedSleeps(`new Pro¤mise(a${blanks})`))).toBeLessThan(LIMIT_MS);
    expect(took(() => fixedSleeps(`new Pro¤mise(a =>${blanks}`))).toBeLessThan(LIMIT_MS);
    expect(took(() => fixedSleeps(`new Pro¤mise(a => {${blanks}`))).toBeLessThan(LIMIT_MS);
  });

  test("20k characters of unclosed generics are scanned in linear time", () => {
    expect(took(() => fixedSleeps("new Pro¤mise<".repeat(1_700)))).toBeLessThan(LIMIT_MS);
    expect(took(() => fixedSleeps(`${"new Pro¤mise<a ".repeat(1_400)}>`))).toBeLessThan(LIMIT_MS);
  });
});

describe("sonar-regex3: fixedSleeps drops the comments with the same result", () => {
  test("a line comment hides what follows it, to the end of the line", () => {
    expect(fixedSleeps("// Bun.sl¤eep(1)")).toBe(0);
    expect(fixedSleeps("run(); // Bun.sl¤eep(1)")).toBe(0);
    expect(fixedSleeps("a//b\nBun.sl¤eep(1)")).toBe(1);
    expect(fixedSleeps("x // one\nBun.sl¤eep(1) // two\nBun.sl¤eep(2)")).toBe(2);
    expect(fixedSleeps("x //\r\nBun.sl¤eep(1)")).toBe(1);
    expect(fixedSleeps("x // c\rBun.sl¤eep(1)")).toBe(1);
    expect(fixedSleeps("x // c\u2028Bun.sl¤eep(1)")).toBe(1);
    expect(fixedSleeps("x // c\u2029Bun.sl¤eep(1)")).toBe(1);
    expect(fixedSleeps("x\n//\n//\nBun.sl¤eep(1)")).toBe(1);
  });

  test("a double slash after a colon is a URL, not a comment", () => {
    expect(fixedSleeps('const u = "http://x"; Bun.sl¤eep(1)')).toBe(1);
    expect(fixedSleeps("://x Bun.sl¤eep(1)")).toBe(1);
    expect(fixedSleeps('const u = ":///x"; Bun.sl¤eep(1)')).toBe(0);
    expect(fixedSleeps("a ://// Bun.sl¤eep(1)")).toBe(0);
    expect(fixedSleeps("a: // Bun.sl¤eep(1)")).toBe(0);
    expect(fixedSleeps("a:\n// Bun.sl¤eep(1)")).toBe(0);
    expect(fixedSleeps("a:/ / Bun.sl¤eep(1)")).toBe(1);
    expect(fixedSleeps("a/ Bun.sl¤eep(1)")).toBe(1);
  });

  test("a block comment hides what it holds and keeps its line breaks", () => {
    expect(fixedSleeps("/* Bun.sl¤eep(1) */")).toBe(0);
    expect(fixedSleeps("/* a\nBun.sl¤eep(1)\n*/ Bun.sl¤eep(2)")).toBe(1);
    expect(fixedSleeps("/* unclosed Bun.sl¤eep(1)")).toBe(1);
    expect(fixedSleeps("/**/ Bun.sl¤eep(1)")).toBe(1);
  });

  test("a timing comment on the line above allows a sleep, blank lines between or not", () => {
    expect(fixedSleeps("// timing: a debounce\nBun.sl¤eep(1)")).toBe(0);
    expect(fixedSleeps("// timing: a debounce\n\n  \nBun.sl¤eep(1)")).toBe(0);
    expect(fixedSleeps("// timing: a debounce\nx()\nBun.sl¤eep(1)")).toBe(1);
    expect(fixedSleeps("// other\nBun.sl¤eep(1)")).toBe(1);
    expect(fixedSleeps("  // timing: why\n  Bun.sl¤eepSync(1)")).toBe(0);
  });

  test("the other spellings count, and a definition or a method does not", () => {
    expect(fixedSleeps("await sl¤eep(1)")).toBe(1);
    expect(fixedSleeps("del¤ay(5)")).toBe(1);
    expect(fixedSleeps("function sl¤eep(ms) {}")).toBe(0);
    expect(fixedSleeps("x.sl¤eep(1)")).toBe(0);
    expect(fixedSleeps("$sl¤eep(1)")).toBe(0);
    expect(fixedSleeps("xsl¤eep(1)")).toBe(0);
  });

  test("20k characters of slashes, colons and comment openers are read in linear time", () => {
    expect(took(() => fixedSleeps("/".repeat(20_000)))).toBeLessThan(LIMIT_MS);
    expect(took(() => fixedSleeps("a//".repeat(6_600)))).toBeLessThan(LIMIT_MS);
    expect(took(() => fixedSleeps(":/".repeat(10_000)))).toBeLessThan(LIMIT_MS);
    expect(took(() => fixedSleeps("://".repeat(6_600)))).toBeLessThan(LIMIT_MS);
    expect(took(() => fixedSleeps(`${"\n".repeat(20_000)}/`))).toBeLessThan(LIMIT_MS);
    expect(took(() => fixedSleeps(`${"\r".repeat(20_000)}//`))).toBeLessThan(LIMIT_MS);
    expect(took(() => fixedSleeps(" //".repeat(6_600)))).toBeLessThan(LIMIT_MS);
    expect(took(() => fixedSleeps("/*".repeat(10_000)))).toBeLessThan(LIMIT_MS);
    expect(took(() => fixedSleeps("x\n// c\n".repeat(3_300)))).toBeLessThan(LIMIT_MS);
  });
});

describe("sonar-regex3: MONEY_WORDS and FIELD_WORDS match the same text", () => {
  const hit = (text: string) => MONEY_WORDS.exec(text)?.[0] ?? null;

  test("the plain words match anywhere, in any case", () => {
    for (const word of [
      "price",
      "billed",
      "billing",
      "hourly",
      "currency",
      "invoice",
      "revenue",
      "profit",
      "salary",
      "money",
    ]) {
      expect(hit(word)).toBe(word);
      expect(hit(word.toUpperCase())).toBe(word.toUpperCase());
      expect(hit(`x_${word}_y`)).toBe(word);
      expect(hit(`my${word}`)).toBe(word);
    }
    expect(hit("Price")).toBe("Price");
    expect(hit("totalPriceUsd")).toBe("Price");
  });

  test("rate and rates match as a word or as the end of a camel-case part", () => {
    expect(hit("rate")).toBe("rate");
    expect(hit("rates")).toBe("rates");
    expect(hit("Rate")).toBe("Rate");
    expect(hit("RATE")).toBe("RATE");
    expect(hit("a rate b")).toBe(" rate ");
    expect(hit("a rates.")).toBe(" rates.");
    expect(hit("hourRate")).toBe("rRate");
    expect(hit("hourRates")).toBe("rRates");
    expect(hit("hourRate2")).toBe("rRate2");
    expect(hit("rate_card")).toBe("rate_");
    expect(hit("1rate")).toBe("1rate");
    expect(hit("_rate_")).toBe("_rate_");
    expect(hit("a\nrate\nb")).toBe("\nrate\n");
    expect(hit("xratex")).toBeNull();
    expect(hit("rated")).toBeNull();
    expect(hit("ratess")).toBeNull();
    expect(hit("ratesx")).toBeNull();
    expect(hit("rat")).toBeNull();
    expect(hit("cards")).toBeNull();
    expect(hit("")).toBeNull();
  });

  test("a word that ends in rate matches, for the flag makes the letter before it any letter", () => {
    expect(hit("separate")).toBe("arate");
    expect(hit("corporate")).toBe("orate");
    expect(hit("generate")).toBe("erate");
    expect(hit("separates")).toBe("arates");
    expect(hit("generated")).toBeNull();
    expect(hit("generator")).toBeNull();
    expect(MONEY_WORDS.test("ratex")).toBe(false);
  });

  test("a field name says money through the same words, or through value", () => {
    expect(FIELD_WORDS.test("hourlyRate")).toBe(true);
    expect(FIELD_WORDS.test("price")).toBe(true);
    expect(FIELD_WORDS.test("value")).toBe(true);
    expect(FIELD_WORDS.test("workValue")).toBe(true);
    expect(FIELD_WORDS.test("VALUE")).toBe(true);
    expect(FIELD_WORDS.test("cardCount")).toBe(false);
    expect(FIELD_WORDS.test("costUsd")).toBe(false);
    expect(FIELD_WORDS.exec("a rate b")?.[0]).toBe(" rate ");
    expect(FIELD_WORDS.exec("valued")?.[0]).toBe("value");
  });

  test("20k characters that nearly match are tested in linear time", () => {
    expect(took(() => MONEY_WORDS.test("rate".repeat(5_000)))).toBeLessThan(LIMIT_MS);
    expect(took(() => MONEY_WORDS.test("rates".repeat(4_000)))).toBeLessThan(LIMIT_MS);
    expect(took(() => MONEY_WORDS.test(`${"x".repeat(20_000)}rat`))).toBeLessThan(LIMIT_MS);
    expect(took(() => FIELD_WORDS.test("pric".repeat(5_000)))).toBeLessThan(LIMIT_MS);
    expect(took(() => FIELD_WORDS.test("Rat ".repeat(5_000)))).toBeLessThan(LIMIT_MS);
  });
});
