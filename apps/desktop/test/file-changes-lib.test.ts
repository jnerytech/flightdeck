import { describe, expect, test } from "bun:test";
import type { DiffFile } from "@flightdeck/protocol";
import { affectedDirs } from "../src/lib/file-changes.ts";

const file = (path: string, status: DiffFile["status"] = "added", oldPath: string | null = null) =>
  ({
    path,
    oldPath,
    status,
    additions: 1,
    deletions: 0,
    uncommitted: true,
    binary: false,
    hunks: [],
  }) as DiffFile;

describe("file-changes-lib: the folders a change of the diff can alter (issue #574)", () => {
  test("a file that came in alters every folder above it, the root first", () => {
    expect(affectedDirs([], [file("a/b/c.md")])).toEqual(["", "a", "a/b"]);
    expect(affectedDirs([], [file("x.md")])).toEqual([""]);
  });

  test("a file that left the diff, or changed its status, alters its folders; the same diff alters none", () => {
    expect(affectedDirs([file("a/c.md")], [])).toEqual(["", "a"]);
    expect(affectedDirs([file("a/c.md", "modified")], [file("a/c.md", "deleted")])).toEqual([
      "",
      "a",
    ]);
    expect(affectedDirs([file("a/c.md")], [file("a/c.md")])).toEqual([]);
  });

  test("a rename alters the folders of both names, each folder once", () => {
    expect(affectedDirs([], [file("b/new.md", "renamed", "a/old.md")])).toEqual(["", "b", "a"]);
    expect(affectedDirs([], [file("a/x.md"), file("a/y.md")])).toEqual(["", "a"]);
  });
});
