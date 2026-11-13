import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { parseJsonOr, parseJsonWith } from "../../src/kernel/json-text.ts";

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

describe("parseJsonWith: an error does not echo the text it read", () => {
  const SECRET = "sk-secret-token-123";
  const Names = z.record(z.string(), z.string());
  const messageOf = (schema: z.ZodType, text: string): string => {
    try {
      parseJsonWith(schema, text);
    } catch (error) {
      return (error as Error).message;
    }
    return expect.unreachable("parseJsonWith should have thrown");
  };
  test("a text that is not JSON throws a message without the text", () => {
    const message = messageOf(Auto, `{"workflow": ${SECRET}`);
    expect(message).toContain("not JSON");
    expect(message).not.toContain(SECRET);
  });
  test("a value that does not fit throws without the value", () => {
    expect(messageOf(Auto, `{"workflow":{"${SECRET}":1}}`)).not.toContain(SECRET);
  });
  test("a key the text chose is not echoed either", () => {
    const message = messageOf(Names, `{"${SECRET}":1}`);
    expect(message).not.toContain(SECRET);
    expect(message).toContain("does not fit");
  });
});
