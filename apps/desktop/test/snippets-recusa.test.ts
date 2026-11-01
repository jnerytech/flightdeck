import { describe, expect, test } from "bun:test";
import { SNIPPET_REASONS } from "@flightdeck/protocol";
import { en } from "../src/i18n/en.ts";
import { refusalText } from "../src/i18n/errors.ts";
import { translator } from "../src/i18n/index.ts";
import { ptBR } from "../src/i18n/pt-BR.ts";

const enT = translator("en");
const ptT = translator("pt-BR");

const REASONS = [
  "name_invalid",
  "needs_run",
  "needs_text",
  "no_text",
  "no_run",
  "too_big",
  "control_command",
  "control_prompt",
  "var_name",
  "var_special",
  "var_unused",
  "too_many_tags",
  "tag_invalid",
  "too_many_options",
  "options_plain",
  "default_control",
  "default_not_option",
  "value_control",
  "value_not_option",
  "missing_values",
  "secret",
];

describe("snippets-recusa: the refusals of the snippet model", () => {
  test("the protocol lists every reason, and each has a text in both languages", () => {
    expect([...SNIPPET_REASONS].sort()).toEqual([...REASONS].sort());
    for (const reason of REASONS) {
      expect(typeof (en.snippetRefusal as Record<string, string>)[reason]).toBe("string");
      expect(typeof (ptBR.snippetRefusal as Record<string, string>)[reason]).toBe("string");
    }
  });

  test("a refusal with a reason is the translated sentence with its params, not the log message", () => {
    const detail = { reason: "var_unused", params: { name: "a" } };
    expect(refusalText("bad_request", "variable a is not used in the text", enT, detail)).toBe(
      "The variable a is not used in the text.",
    );
    expect(refusalText("bad_request", "variable a is not used in the text", ptT, detail)).toBe(
      "A variável a não é usada no texto.",
    );
  });

  test("without a reason, or with one the app does not know, it falls back to the code's text and the message", () => {
    expect(refusalText("bad_request", "raw", enT)).toBe("The host refused the request. raw");
    expect(refusalText("bad_request", "raw", enT, { reason: "from_the_future" })).toBe(
      "The host refused the request. raw",
    );
  });
});
