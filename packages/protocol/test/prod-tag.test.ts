import { describe, expect, test } from "bun:test";
import { isProd, isProdTag } from "../src/index.ts";

describe("regras-padroes: the one production tag rule", () => {
  test("prod, produção and producao are production, in any case; other tags are not", () => {
    for (const tag of ["prod", "PROD", "produção", "Produção", "producao", "PRODUCAO"]) {
      expect(isProdTag(tag)).toBe(true);
    }
    for (const tag of ["staging", "production", "pro", "prod-like", ""]) {
      expect(isProdTag(tag)).toBe(false);
    }
    expect(isProd(["staging", "producao"])).toBe(true);
    expect(isProd(undefined)).toBe(false);
  });
});
