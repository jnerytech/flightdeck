import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { DIFF_FILE_MAX, workingDiff } from "../src/board/diff.ts";
import { gitRepo } from "./board-helpers.ts";

// Real git in temp repositories.
setDefaultTimeout(30_000);

/** Text of `bytes` bytes in lines of 99 characters and a newline. */
const text = (bytes: number) => {
  const line = `${"x".repeat(99)}\n`;
  return line.repeat(Math.floor(bytes / line.length)).padEnd(bytes, "y");
};

const only = async (repo: string, path: string, max?: number) => {
  const files = max === undefined ? await workingDiff(repo) : await workingDiff(repo, max);
  return files.find((f) => f.path === path);
};

describe("changes-cap: a new file over the cap is listed with its size and no content", () => {
  test("a file one byte over the cap has the marker, its real size, and no hunks", async () => {
    const { repo } = gitRepo();
    writeFileSync(join(repo, "dump.log"), text(DIFF_FILE_MAX + 1));
    expect(await only(repo, "dump.log")).toMatchObject({
      status: "added",
      uncommitted: true,
      binary: false,
      tooLarge: true,
      bytes: DIFF_FILE_MAX + 1,
      hunks: [],
    });
  });

  test("a file of exactly the cap is shown whole and carries no marker", async () => {
    const { repo } = gitRepo();
    writeFileSync(join(repo, "edge.log"), text(DIFF_FILE_MAX));
    const file = await only(repo, "edge.log");
    expect(file?.tooLarge).toBeUndefined();
    expect(file?.hunks.length).toBe(1);
    expect(file?.additions).toBeGreaterThan(0);
  });

  test("a file of 4 MB on one line is listed with its size too, never read whole", async () => {
    const { repo } = gitRepo();
    writeFileSync(join(repo, "bundle.min.js"), "a".repeat(4 * 1024 * 1024));
    expect(await only(repo, "bundle.min.js")).toMatchObject({
      tooLarge: true,
      bytes: 4 * 1024 * 1024,
      hunks: [],
    });
  });

  test("the caller's own cap still applies (the assistant reads less), and a small file is untouched", async () => {
    const { repo } = gitRepo();
    writeFileSync(join(repo, "mid.txt"), text(300 * 1024));
    writeFileSync(join(repo, "small.txt"), "um\ndois\n");
    expect(await only(repo, "mid.txt", 256 * 1024)).toMatchObject({
      tooLarge: true,
      bytes: 300 * 1024,
    });
    expect(await only(repo, "mid.txt")).toMatchObject({ hunks: expect.any(Array) });
    expect((await only(repo, "mid.txt"))?.tooLarge).toBeUndefined();
    expect(await only(repo, "small.txt")).toMatchObject({ additions: 2, binary: false });
  });

  test("a binary file under the cap is still binary, not too large", async () => {
    const { repo } = gitRepo();
    writeFileSync(join(repo, "img.bin"), Buffer.from([0, 1, 2, 0, 255]));
    const file = await only(repo, "img.bin");
    expect(file?.binary).toBe(true);
    expect(file?.tooLarge).toBeUndefined();
  });
});
