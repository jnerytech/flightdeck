import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { QUARANTINE_FILE, readQuarantine } from "../lib/quarantine.ts";

const ROOT = resolve(import.meta.dir, "../..");

/** The most tests the quarantine may hold: lower it when a test comes out, never raise it. */
const QUARANTINE_MAX = 5;

describe("quarantine-ratchet: the list only shrinks, and every entry has an owner (issue #288)", () => {
  const entries = readQuarantine(ROOT);

  test("the five wall-clock tests of the first run are listed", () => {
    expect(entries.map((e) => e.file).sort()).toEqual([
      "apps/daemon/test/heartbeat.test.ts",
      "apps/desktop/test/hub-list.test.tsx",
      "apps/desktop/test/platform.test.ts",
      "apps/desktop/test/proto-restore.test.ts",
      "apps/desktop/test/wait.test.ts",
    ]);
  });

  test("the list holds no more than the maximum", () => {
    expect(entries.length).toBeLessThanOrEqual(QUARANTINE_MAX);
  });

  test("every entry names an issue and says why, in a line", () => {
    for (const e of entries) {
      expect(Number.isInteger(e.issue) && e.issue > 0, `${e.file}: issue`).toBe(true);
      expect(e.reason.trim().length > 0 && !e.reason.includes("\n"), `${e.file}: reason`).toBe(
        true,
      );
    }
  });

  test("every entry is a test that still exists, once: a renamed or deleted one comes off the list", () => {
    const seen = new Set<string>();
    for (const e of entries) {
      const path = join(ROOT, e.file);
      expect(existsSync(path), `${e.file} exists`).toBe(true);
      expect(readFileSync(path, "utf8").includes(e.test), `${e.file} has "${e.test}"`).toBe(true);
      expect(seen.has(`${e.file}\n${e.test}`), `${e.file}: "${e.test}" twice`).toBe(false);
      seen.add(`${e.file}\n${e.test}`);
    }
  });

  test("the list file is where the scripts read it", () => {
    expect(QUARANTINE_FILE).toBe("scripts/test/quarantine.json");
  });
});
