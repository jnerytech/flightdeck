import { describe, expect, test } from "bun:test";
import { previewOf } from "../../src/checkpoints/domain/rewind-preview.ts";

// `git diff -z` prints `status NUL path NUL` and `added TAB removed TAB path NUL`, paths never quoted.
const nameStatus = (...records: Array<[string, string]>) =>
  records.map(([status, path]) => `${status}\0${path}\0`).join("");
const numstat = (...records: Array<[number, number, string]>) =>
  records.map(([added, removed, path]) => `${added}\t${removed}\t${path}\0`).join("");

describe("previewOf: the files and lines going back to a snapshot would change", () => {
  test("nothing differs: no files and no lines", () => {
    expect(previewOf("", "")).toEqual({ files: [], insertions: 0, deletions: 0 });
  });

  test("a created, a deleted and a changed file each get their word, in the order git gave", () => {
    const { files } = previewOf(
      nameStatus(["A", "new.ts"], ["D", "gone.ts"], ["M", "same.ts"]),
      "",
    );
    expect(files).toEqual([
      { path: "new.ts", change: "created" },
      { path: "gone.ts", change: "deleted" },
      { path: "same.ts", change: "modified" },
    ]);
  });

  test("a status git has no word for reads as modified", () => {
    expect(previewOf(nameStatus(["T", "link.ts"]), "").files).toEqual([
      { path: "link.ts", change: "modified" },
    ]);
  });

  test("a path with an accent, a quote, a space, an emoji or a newline reads back whole", () => {
    const paths = ["açaí.txt", 'say "hi".txt', "with space.txt", "🚀.md", "two\nlines.txt"];
    const { files } = previewOf(nameStatus(...paths.map((p): [string, string] => ["M", p])), "");
    expect(files.map((f) => f.path)).toEqual(paths);
  });

  test("lines are seen from the target: what was added after it goes away, what was removed comes back", () => {
    const stats = previewOf("", numstat([5, 2, "a.ts"], [1, 7, "b ç.ts"]));
    expect({ insertions: stats.insertions, deletions: stats.deletions }).toEqual({
      insertions: 9,
      deletions: 6,
    });
  });

  test("a binary file (numstat prints - for both counts) adds no lines", () => {
    const stats = previewOf("", "-\t-\timage.png\0");
    expect({ insertions: stats.insertions, deletions: stats.deletions }).toEqual({
      insertions: 0,
      deletions: 0,
    });
  });
});
