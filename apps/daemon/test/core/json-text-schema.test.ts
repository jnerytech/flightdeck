import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { parseJsonOr, parseJsonWith } from "../../src/json-text.ts";

const Auto = z.object({ workflow: z.string().nullable() });

describe("parseJsonWith", () => {
  test("returns the value when the text fits the schema", () => {
    expect(parseJsonWith(Auto, '{"workflow":"build"}')).toEqual({ workflow: "build" });
  });
  test("parses past a leading byte order mark", () => {
    expect(parseJsonWith(Auto, '﻿{"workflow":null}')).toEqual({ workflow: null });
  });
  test("throws when the text is not JSON", () => {
    expect(() => parseJsonWith(Auto, "{nope")).toThrow();
  });
  test("throws when the JSON does not fit the schema", () => {
    expect(() => parseJsonWith(Auto, '{"workflow":3}')).toThrow();
  });
});

describe("parseJsonOr", () => {
  test("returns the value when the text fits the schema", () => {
    expect(parseJsonOr(Auto, '{"workflow":"build"}', { workflow: null })).toEqual({
      workflow: "build",
    });
  });
  test("returns the fallback when the text is not JSON", () => {
    expect(parseJsonOr(Auto, "{nope", { workflow: null })).toEqual({ workflow: null });
  });
  test("returns the fallback when the JSON does not fit the schema", () => {
    expect(parseJsonOr(Auto, '{"workflow":3}', { workflow: "x" })).toEqual({ workflow: "x" });
  });
});
