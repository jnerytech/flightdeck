import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { appendFileSync, existsSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cardDiff, DIFF_FILE_MAX, DIFF_LIMITS, workingDiff } from "../src/board/diff.ts";
import { git, gitRepo } from "./board-helpers.ts";

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

/** Lines of 99 characters and a newline: `n` of them, the size of the diff that adds them. */
const lines = (n: number, tag = "x") => `${`${tag.repeat(99)}\n`.repeat(n)}`;
const commit = (repo: string, message: string) => {
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", message);
};

describe("changes-cap: a tracked change whose diff is over the cap is listed with its size and no content", () => {
  test("a tracked file with 600 KB of new lines keeps its counts and loses its hunks", async () => {
    const { repo } = gitRepo();
    writeFileSync(join(repo, "big.txt"), lines(10));
    commit(repo, "big");
    appendFileSync(join(repo, "big.txt"), lines(6000, "y"));
    const file = await only(repo, "big.txt");
    expect(file).toMatchObject({
      status: "modified",
      uncommitted: true,
      binary: false,
      additions: 6000,
      deletions: 0,
      tooLarge: true,
      hunks: [],
    });
    expect(file?.bytes).toBeGreaterThan(DIFF_FILE_MAX);
  });

  test("a change of 100 lines is shown whole beside it", async () => {
    const { repo } = gitRepo();
    writeFileSync(join(repo, "big.txt"), lines(10));
    writeFileSync(join(repo, "small.txt"), lines(10));
    commit(repo, "two");
    appendFileSync(join(repo, "big.txt"), lines(6000, "y"));
    appendFileSync(join(repo, "small.txt"), lines(100, "z"));
    const small = await only(repo, "small.txt");
    expect(small?.tooLarge).toBeUndefined();
    expect(small).toMatchObject({ additions: 100, hunks: [expect.anything()] });
  });

  test("the caller can cap tracked diffs lower than the default", async () => {
    const { repo } = gitRepo();
    writeFileSync(join(repo, "mid.txt"), lines(10));
    commit(repo, "mid");
    appendFileSync(join(repo, "mid.txt"), lines(100, "y"));
    expect(
      (await workingDiff(repo, DIFF_FILE_MAX, 5000)).find((f) => f.path === "mid.txt"),
    ).toMatchObject({
      tooLarge: true,
      hunks: [],
    });
    expect((await only(repo, "mid.txt"))?.tooLarge).toBeUndefined();
  });

  test("commits since the base are capped the same way as what is not committed yet", async () => {
    const { repo } = gitRepo();
    git(repo, "checkout", "-q", "-b", "work");
    writeFileSync(join(repo, "gen.txt"), lines(6000));
    commit(repo, "generated");
    const { files } = await cardDiff(repo, "main");
    expect(files.find((f) => f.path === "gen.txt")).toMatchObject({
      status: "added",
      uncommitted: false,
      additions: 6000,
      tooLarge: true,
      hunks: [],
    });
  });
});

const big = { totalBytes: 1e9, rawBytes: 1e9 };
const shownBytes = (file: { hunks: Array<{ lines: Array<{ text: string }> }> }) =>
  file.hunks.reduce((sum, h) => sum + h.lines.reduce((n, l) => n + l.text.length + 2, 0), 0);

describe("changes-cap: the whole answer has a budget, and a huge diff is not read to the end", () => {
  test("the default limits are 4 MB of shown diff and 16 MB of git output", () => {
    expect(DIFF_LIMITS).toEqual({ totalBytes: 4 * 1024 * 1024, rawBytes: 16 * 1024 * 1024 });
  });

  test("thirty files of 100 KB each: the first ones are shown while the budget lasts, all are listed", async () => {
    const { repo } = gitRepo();
    const names = Array.from({ length: 30 }, (_, i) => `f${String(i).padStart(2, "0")}.txt`);
    for (const name of names) writeFileSync(join(repo, name), lines(10));
    commit(repo, "thirty");
    for (const name of names) appendFileSync(join(repo, name), lines(1000, "y"));
    const files = (
      await workingDiff(repo, DIFF_FILE_MAX, DIFF_FILE_MAX, { ...big, totalBytes: 1_000_000 })
    ).filter((f) => names.includes(f.path));
    expect(files.map((f) => f.path)).toEqual(names);
    const shown = files.filter((f) => !f.tooLarge);
    expect(shown.length).toBeGreaterThanOrEqual(5);
    expect(shown.length).toBeLessThan(30);
    expect(shown.reduce((sum, f) => sum + shownBytes(f), 0)).toBeLessThanOrEqual(1_000_000);
    // Once the budget is spent every later file is only listed, with its counts and size.
    expect(
      files.slice(shown.length).every((f) => f.tooLarge === true && f.hunks.length === 0),
    ).toBe(true);
    expect(files.at(-1)).toMatchObject({ additions: 1000, deletions: 0, tooLarge: true });
  });

  test("a 3 MB change is cut at the raw limit, listed with exact counts, and the files after it are still listed", async () => {
    const { repo } = gitRepo();
    writeFileSync(join(repo, "big.txt"), lines(10));
    writeFileSync(join(repo, "z-after.txt"), "um\n");
    commit(repo, "two");
    appendFileSync(join(repo, "big.txt"), lines(30_000, "y"));
    appendFileSync(join(repo, "z-after.txt"), "dois\n");
    const files = await workingDiff(repo, DIFF_FILE_MAX, 1e9, { ...big, rawBytes: 512 * 1024 });
    expect(files.find((f) => f.path === "big.txt")).toMatchObject({
      additions: 30_000,
      deletions: 0,
      tooLarge: true,
      hunks: [],
    });
    expect(files.find((f) => f.path === "z-after.txt")).toMatchObject({
      additions: 1,
      deletions: 0,
      tooLarge: true,
      hunks: [],
    });
  });

  test("a diff under the raw limit is read whole and nothing is marked", async () => {
    const { repo } = gitRepo();
    writeFileSync(join(repo, "a.txt"), "um\n");
    commit(repo, "a");
    appendFileSync(join(repo, "a.txt"), "dois\n");
    const file = (
      await workingDiff(repo, DIFF_FILE_MAX, DIFF_FILE_MAX, { ...big, rawBytes: 512 * 1024 })
    ).find((f) => f.path === "a.txt");
    expect(file?.tooLarge).toBeUndefined();
    expect(file?.additions).toBe(1);
  });
});

describe("changes-cap: a cut diff still says what each file is", () => {
  test("a rename, a deleted file and a binary change keep their status and counts when git's output is cut", async () => {
    const { repo } = gitRepo();
    writeFileSync(join(repo, "a-huge.txt"), lines(10));
    writeFileSync(join(repo, "moved.txt"), lines(5));
    writeFileSync(join(repo, "gone.txt"), lines(3));
    writeFileSync(join(repo, "pic.bin"), Buffer.from([0, 1, 2, 3]));
    commit(repo, "four");
    appendFileSync(join(repo, "a-huge.txt"), lines(30_000, "y"));
    renameSync(join(repo, "moved.txt"), join(repo, "z-moved.txt"));
    appendFileSync(join(repo, "z-moved.txt"), "mais\n");
    rmSync(join(repo, "gone.txt"));
    writeFileSync(join(repo, "pic.bin"), Buffer.from([0, 9, 9, 9, 9]));
    git(repo, "add", "-A");
    const files = await workingDiff(repo, DIFF_FILE_MAX, 1e9, { ...big, rawBytes: 512 * 1024 });
    const by = (path: string) => files.find((f) => f.path === path);
    expect(by("a-huge.txt")).toMatchObject({
      status: "modified",
      additions: 30_000,
      tooLarge: true,
    });
    expect(by("z-moved.txt")).toMatchObject({
      status: "renamed",
      oldPath: "moved.txt",
      additions: 1,
      deletions: 0,
    });
    expect(by("gone.txt")).toMatchObject({ status: "deleted", additions: 0, deletions: 3 });
    expect(by("pic.bin")).toMatchObject({ binary: true, additions: 0, deletions: 0 });
    expect(by("pic.bin")?.tooLarge).toBeUndefined();
  });
});

describe("changes-cap: what git wrote before it was cut is kept once", () => {
  test("a small file read whole before the cut is shown with its lines, the cut one and the rest are listed, none twice", async () => {
    const { repo } = gitRepo();
    writeFileSync(join(repo, "a-small.txt"), "um\n");
    writeFileSync(join(repo, "b-huge.txt"), lines(10));
    writeFileSync(join(repo, "c-after.txt"), "tres\n");
    commit(repo, "three");
    appendFileSync(join(repo, "a-small.txt"), "dois\n");
    appendFileSync(join(repo, "b-huge.txt"), lines(30_000, "y"));
    appendFileSync(join(repo, "c-after.txt"), "quatro\n");
    const files = await workingDiff(repo, DIFF_FILE_MAX, 1e9, { ...big, rawBytes: 512 * 1024 });
    expect(files.map((f) => f.path)).toEqual(["a-small.txt", "b-huge.txt", "c-after.txt"]);
    expect(files[0]?.tooLarge).toBeUndefined();
    expect(files[0]?.hunks[0]?.lines.map((l) => l.text)).toEqual(["um", "dois"]);
    expect(files.slice(1).map((f) => [f.tooLarge, f.hunks.length])).toEqual([
      [true, 0],
      [true, 0],
    ]);
  });
});

describe("changes-cap: a base branch is a revision, never an option of git", () => {
  test("a base that looks like git's --output option writes nothing and is refused", async () => {
    const { repo, root } = gitRepo();
    const out = join(root, "stolen");
    await expect(cardDiff(repo, `--output=${out}`)).rejects.toThrow();
    expect(existsSync(`${out}...HEAD`)).toBe(false);
  });
});
