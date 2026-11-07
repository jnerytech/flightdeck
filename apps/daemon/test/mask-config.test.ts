import { describe, expect, test } from "bun:test";
import { maskConfig } from "../src/permissions/mask-config.ts";

/** Issue #806: what the masker shows of an MCP config line by line, and what it never does. */
const text = (lines: string[], unknownStart = false) => maskConfig(lines, unknownStart).join("\n");

describe("mask-config: the lines of an MCP config with the private values masked (#806)", () => {
  test("a hunk that opens on a secret flag masks the value on the next line", () => {
    const out = text(
      ['    "--token",', '    "S3-private"', '    "--api-key",', '    "S4-private"'],
      true,
    );
    expect([out.includes("S3-private"), out.includes("S4-private")]).toEqual([false, false]);
  });

  test("an env or headers object on one line masks every value in it, however its keys are named, and ends at its brace", () => {
    const nested = text([
      '{"a":{"env":{"command":"S1-private","url":"https://h/S2-private"},"command":"sh"}}',
    ]);
    const plain = text(['"env": {"command": "S5-private"}, "headers": {"type": "S6-private"}']);
    expect([
      /S1-private|S2-private/.test(nested),
      nested.includes('"command":"sh"'),
      /S5-private|S6-private/.test(plain),
    ]).toEqual([false, true, false]);
  });

  test("a header passed as an argument is masked, and a plain argument is not", () => {
    const out = text(['"args": ["--header", "Authorization: S7-private", "--name", "visible"]']);
    expect([out.includes("S7-private"), out.includes("visible")]).toEqual([false, true]);
  });
});
