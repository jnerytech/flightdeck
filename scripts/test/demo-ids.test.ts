import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeHistory } from "../demo-seed.ts";
import { realTempDir } from "./temp-dir.ts";

/** Every `.jsonl` under `dir`, subagent folders included. */
function transcripts(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? transcripts(join(dir, entry.name))
      : entry.name.endsWith(".jsonl")
        ? [join(dir, entry.name)]
        : [],
  );
}

test("no assistant message id is in two transcripts of the demo, or the usage counts it for the first file read", () => {
  const history = realTempDir("fd-demo-ids-");
  writeHistory(history, "/work/flightdeck-web");
  const files = new Map<string, Set<string>>();
  for (const file of transcripts(history)) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      // Some transcripts hold a line on purpose that is not JSON: the usage skips it too.
      let id: unknown;
      try {
        id = (JSON.parse(line) as { message?: { id?: unknown } }).message?.id;
      } catch {
        continue;
      }
      if (typeof id !== "string") continue;
      files.set(id, (files.get(id) ?? new Set()).add(file));
    }
  }
  const shared = [...files].filter(([, set]) => set.size > 1).map(([id]) => id);
  expect(shared).toEqual([]);
});
