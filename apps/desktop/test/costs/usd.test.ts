import { describe, expect, test } from "bun:test";
import { usd } from "../../src/lib/costs.ts";

describe("usd: dollars follow the app language (#1332)", () => {
  test("pt-BR uses the dot for thousands and the comma for cents", () => {
    expect(usd(5000, "pt-BR")).toBe("US$ 5.000,00");
    expect(usd(0.23, "pt-BR")).toBe("US$ 0,23");
    expect(usd(1234567.5, "pt-BR")).toBe("US$ 1.234.567,50");
  });

  test("English keeps the dot for cents and groups thousands with a comma", () => {
    expect(usd(5000, "en")).toBe("US$ 5,000.00");
    expect(usd(0.23, "en")).toBe("US$ 0.23");
  });

  test("a per-item cost can ask for more decimals, in both languages", () => {
    expect(usd(0.01234, "en", 4)).toBe("US$ 0.0123");
    expect(usd(0.01234, "pt-BR", 4)).toBe("US$ 0,0123");
  });

  test("zero and rounding", () => {
    expect(usd(0, "pt-BR")).toBe("US$ 0,00");
    expect(usd(1.005, "en")).toBe("US$ 1.01");
  });
});
