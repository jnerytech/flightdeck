import { describe, expect, test } from "bun:test";
import { RULE_ISSUE_CODES } from "@flightdeck/protocol";
import { en } from "../src/i18n/en.ts";
import { ruleIssueText } from "../src/i18n/errors.ts";
import { translator } from "../src/i18n/index.ts";
import { ptBR } from "../src/i18n/pt-BR.ts";

const enT = translator("en");
const ptT = translator("pt-BR");

const CODES = [
  "required",
  "duplicate",
  "unknown_field",
  "not_object",
  "not_list",
  "not_text",
  "not_list_of_text",
  "not_one_of",
  "bad_time",
  "same_time",
  "not_positive_int",
  "not_timestamp",
  "once_needs_ask",
  "outside_needs_window",
  "no_allow_run_with_secret",
  "prod_needs_window",
];

describe("recusas-regras: what is wrong in a vault rule, said in the app's language", () => {
  test("the protocol lists every kind of issue, and each has a text in both languages", () => {
    expect([...(RULE_ISSUE_CODES as readonly string[])].sort()).toEqual([...CODES].sort());
    for (const code of CODES) {
      expect(typeof (en.ruleIssue as Record<string, string>)[code]).toBe("string");
      expect(typeof (ptBR.ruleIssue as Record<string, string>)[code]).toBe("string");
    }
  });

  test("an issue is one sentence with its params, and the field of an unknown_field is named", () => {
    const allowed = { allowed: "allow, ask, deny" };
    expect(ruleIssueText({ path: "0.decision", code: "not_one_of", params: allowed }, enT)).toBe(
      "Only these values are accepted: allow, ask, deny.",
    );
    expect(ruleIssueText({ path: "0.decision", code: "not_one_of", params: allowed }, ptT)).toBe(
      "Só estes valores são aceitos: allow, ask, deny.",
    );
    expect(ruleIssueText({ path: "2.match.quem", code: "unknown_field" }, enT)).toBe(
      "This field does not exist: quem.",
    );
  });

  test("a code the app does not know shows its path and code, not nothing", () => {
    expect(ruleIssueText({ path: "1.x", code: "from_the_future" }, enT)).toBe(
      "1.x: from_the_future",
    );
  });
});
