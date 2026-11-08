import { describe, expect, test } from "bun:test";
import { normalizeOutput } from "../src/assistant-prompts.ts";

/** #363 (Sonar S8786): the trailing-space strip of normalizeOutput keeps its exact reach. */
describe("sonar363-normalize: normalizeOutput trailing whitespace", () => {
  test("drops every kind of trailing space the regex \\s covered", () => {
    const tail = " \t\r\n  　﻿ ";
    expect(normalizeOutput("prompt", `Do it well${tail}`)).toBe("Do it well");
    expect(normalizeOutput("prompt", `${tail}Do it well${tail}`)).toBe(
      // Leading: only whole blank lines go; trim() takes the rest.
      "Do it well",
    );
  });

  test("keeps whitespace inside the text, even long runs of it", () => {
    const gap = " ".repeat(3000);
    expect(normalizeOutput("prompt", `a${gap}b${gap}`)).toBe(`a${gap}b`);
    expect(normalizeOutput("prompt", `a\n\n\n${gap}\nb \n`)).toBe(`a\n\n\n${gap}\nb`);
  });

  test("an answer of only whitespace is empty, and a leading blank line goes", () => {
    expect(normalizeOutput("prompt", " \n\t \n ")).toBe("");
    expect(normalizeOutput("prompt", "\n\nDo it well")).toBe("Do it well");
    expect(normalizeOutput("prompt", "  \nDo it well")).toBe("Do it well");
  });

  test("the fence and the preamble still match after the strip", () => {
    expect(normalizeOutput("prompt", "```\nDo it well\n```  \n\n")).toBe("Do it well");
    expect(normalizeOutput("prompt", "Here is it:  \n\nDo it well \n")).toBe("Do it well");
  });
});
