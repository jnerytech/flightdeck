import { describe, expect, test } from "bun:test";
import { translator } from "../src/i18n/index.ts";
import { reasonText } from "../src/lib/notice-text.ts";

describe("notice-text: a card's or run's problem reads in the app's language", () => {
  const params = { code: 3, output: "deu ruim" };
  test("a reason the app knows is told in the language, with its values", () => {
    expect(reasonText(translator("pt-BR"), "setup script failed", "setup_failed", params)).toBe(
      "A preparação do projeto falhou (código 3): deu ruim",
    );
    expect(reasonText(translator("en"), "setup script failed", "setup_failed", params)).toBe(
      "The project's setup script failed (exit 3): deu ruim",
    );
  });

  test("a reason from a newer daemon, or none (an older daemon), keeps the text it sent", () => {
    expect(reasonText(translator("pt-BR"), "texto antigo", "reason_of_the_future", params)).toBe(
      "texto antigo",
    );
    expect(reasonText(translator("pt-BR"), "texto antigo")).toBe("texto antigo");
    expect(reasonText(translator("pt-BR"), "texto antigo", null, null)).toBe("texto antigo");
  });
});
