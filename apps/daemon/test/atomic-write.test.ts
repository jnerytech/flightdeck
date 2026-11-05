import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { appendFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "../src/atomic-write.ts";
import { liveReceptor } from "../src/central/wrapper.ts";
import { tempDir } from "./helpers.ts";

describe("atomic-write: a reader sees the old file or the new one, never half of it (issue #138)", () => {
  test("while a slow writer is between its two halves, the file still holds the old whole content", async () => {
    const dir = tempDir();
    const file = join(dir, "receptor.json");
    writeFileSync(file, JSON.stringify({ url: "http://127.0.0.1:1111" }));
    const seen: string[] = [];
    const whole = JSON.stringify({ url: "http://127.0.0.1:2222" });
    await writeFileAtomic(file, whole, {
      // A writer that stops between two parts, as a loaded disk or a slow runner does.
      write: async (path, data) => {
        const half = Math.floor(data.length / 2);
        writeFileSync(path, data.slice(0, half));
        seen.push(readFileSync(file, "utf8"));
        await appendFile(path, data.slice(half));
      },
      rename,
    });
    expect(seen.map((text) => JSON.parse(text))).toEqual([{ url: "http://127.0.0.1:1111" }]);
    expect(readFileSync(file, "utf8")).toBe(whole);
    expect(readdirSync(dir)).toEqual(["receptor.json"]);
  });
});

describe("atomic-write: the reader of receptor.json is not caught by a half file either", () => {
  test("a half-written receptor file means no receptor yet, not a crash", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "receptor.json"), '{"url":"http://127.0.0');
    expect(existsSync(join(dir, "receptor.json"))).toBe(true);
    expect(await liveReceptor(dir, 200)).toBeNull();
  });
});
