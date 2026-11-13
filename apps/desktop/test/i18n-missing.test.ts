import { describe, expect, test } from "bun:test";
import { translator } from "../src/i18n/index.ts";

describe("i18n-missing: a key the dictionary lacks shows its last part instead of throwing (HD-M2)", () => {
  test("a missing entry, whole or in the middle of the path, gives the last part of the key in both languages", () => {
    for (const lang of ["en", "pt-BR"] as const) {
      const t = translator(lang) as unknown as (key: string) => string;
      expect(t("hostDeps.names.future")).toBe("future");
      expect(t("nothing.here.at.all")).toBe("all");
    }
  });
});
