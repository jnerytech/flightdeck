import { describe, expect, test } from "bun:test";
import { type ReviewItem, reviewMessage } from "../src/review-message.ts";

const item = (over: Partial<ReviewItem> = {}): ReviewItem => ({
  path: "app.ts",
  lineStart: 12,
  lineEnd: 12,
  quote: "const total = a + b;",
  body: "use the cart total",
  ...over,
});

describe("reviewMessage", () => {
  test("in English the header and the line label are English", () => {
    expect(reviewMessage([item(), item({ lineStart: 3, lineEnd: 5 })], "en")).toBe(
      [
        "Review of the changes:",
        "1. `app.ts` line 12:",
        "   > const total = a + b;",
        "   use the cart total",
        "2. `app.ts` lines 3–5:",
        "   > const total = a + b;",
        "   use the cart total",
      ].join("\n"),
    );
  });

  test("with no language the message is English, like the rest the app sends to Claude Code", () => {
    expect(reviewMessage([item()]).split("\n")[0]).toBe("Review of the changes:");
  });

  test("one comment is the header, the file and line, the quote and the comment", () => {
    expect(reviewMessage([item()], "pt-BR")).toBe(
      [
        "Revisão das mudanças:",
        "1. `app.ts` linha 12:",
        "   > const total = a + b;",
        "   use the cart total",
      ].join("\n"),
    );
  });

  test("two comments on two files go in one message, numbered in the order given", () => {
    const text = reviewMessage(
      [
        item(),
        item({
          path: "cart.ts",
          lineStart: 3,
          lineEnd: 5,
          quote: "a\nb\nc",
          body: "rename\nthese",
        }),
      ],
      "pt-BR",
    );
    expect(text).toBe(
      [
        "Revisão das mudanças:",
        "1. `app.ts` linha 12:",
        "   > const total = a + b;",
        "   use the cart total",
        "2. `cart.ts` linhas 3–5:",
        "   > a",
        "   > b",
        "   > c",
        "   rename",
        "   these",
      ].join("\n"),
    );
  });

  test("a trailing newline in a quote adds no empty quoted line", () => {
    expect(reviewMessage([item({ quote: "x\n" })])).toContain("   > x\n   use");
  });
});
