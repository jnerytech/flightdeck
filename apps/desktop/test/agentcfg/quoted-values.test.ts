import { expect, test } from "bun:test";
import { getField, parseDocument } from "../../src/features/agentcfg/frontmatter.ts";

const field = (value: string) =>
  getField(parseDocument(`---\ndescription: ${value}\n---\nbody\n`), "description");

test("a double-quoted value has its escapes undone (#1609)", () => {
  expect(field('"say \\"hi\\"\\tnow"')).toBe('say "hi"\tnow');
});

test("a double-quoted value with a bad escape is kept as the file spells it (#1609)", () => {
  expect(field('"bad \\q escape"')).toBe('"bad \\q escape"');
});
