import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { readFakeEvents } from "../support/fake-claude.ts";
import { tempDir } from "../support/helpers.ts";

/** Issue #2789: the fake may still be writing the last events.jsonl line when a test reads it. */
function eventsOf(eventsFile: string): ReturnType<typeof readFakeEvents> {
  const dir = tempDir("fd-fake-events-");
  writeFileSync(join(dir, "events.jsonl"), eventsFile);
  return readFakeEvents(dir);
}

describe("fake claude events()", () => {
  test("a last line still being written is left out, the finished lines are returned", () => {
    expect(eventsOf('{"type":"start"}\n{"type":"hook","event":"Sess')).toEqual([{ type: "start" }]);
  });

  test("every newline-terminated line is returned, CRLF included", () => {
    expect(eventsOf('{"type":"start"}\r\n{"type":"hook"}\n')).toEqual([
      { type: "start" },
      { type: "hook" },
    ]);
  });

  test("a file with no finished line yet returns nothing", () => {
    expect(eventsOf('{"type":"sta')).toEqual([]);
  });
});
