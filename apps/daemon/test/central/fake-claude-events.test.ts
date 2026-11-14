import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { type FakeClaude, installFakeClaude } from "../support/fake-claude.ts";

/** Issue #2789: the fake may still be writing the last events.jsonl line when a test reads it. */
const fakes: FakeClaude[] = [];
afterEach(() => {
  for (const fake of fakes.splice(0)) fake.restore();
});

function fakeWith(eventsFile: string): FakeClaude {
  const fake = installFakeClaude([], { PATH: "" });
  fakes.push(fake);
  writeFileSync(join(fake.dir, "events.jsonl"), eventsFile);
  return fake;
}

describe("fake claude events()", () => {
  test("a last line still being written is left out, the finished lines are returned", () => {
    const fake = fakeWith('{"type":"start"}\n{"type":"hook","event":"Sess');
    expect(fake.events()).toEqual([{ type: "start" }]);
  });

  test("every newline-terminated line is returned, CRLF included", () => {
    const fake = fakeWith('{"type":"start"}\r\n{"type":"hook"}\n');
    expect(fake.events()).toEqual([{ type: "start" }, { type: "hook" }]);
  });

  test("a file with no finished line yet returns nothing", () => {
    const fake = fakeWith('{"type":"sta');
    expect(fake.events()).toEqual([]);
  });
});
