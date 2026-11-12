import { describe, expect, test } from "bun:test";
import { ASSISTANT_REASONS } from "@flightdeck/protocol";
import { en } from "../../src/i18n/en.ts";
import { ptBR } from "../../src/i18n/pt-BR.ts";

describe("assistant-refusal-texts", () => {
  test("every reason the protocol lists has a text in English, and no text is left without a reason", () => {
    expect(Object.keys(en.assistantRefusal).sort()).toEqual([...ASSISTANT_REASONS].sort());
  });

  test("every reason the protocol lists has a text in Portuguese, and no text is left without a reason", () => {
    expect(Object.keys(ptBR.assistantRefusal).sort()).toEqual([...ASSISTANT_REASONS].sort());
  });
});
