import { describe, expect, test } from "bun:test";
import { type CacheFiles, seedCache } from "../lib/tsc-cache.ts";

/** An in-memory cache: path to its last change in ms. */
function memory(at: Record<string, number>) {
  const copies: [string, string][] = [];
  const files: CacheFiles = {
    exists: (path) => path in at,
    mtime: (path) => at[path] ?? 0,
    copy: (from, to) => {
      copies.push([from, to]);
    },
  };
  return { files, copies };
}

const C = "node_modules/.cache/tsc";

describe("seedCache", () => {
  test("a build info this checkout lacks comes from the sibling that changed it last", () => {
    const m = memory({
      [`/w/old/${C}/a.tsbuildinfo`]: 100,
      [`/w/new/${C}/a.tsbuildinfo`]: 300,
      [`/w/mid/${C}/a.tsbuildinfo`]: 200,
    });
    const seeded = seedCache({
      root: "/w/me",
      siblings: ["/w/old", "/w/new", "/w/mid"],
      names: ["a.tsbuildinfo"],
      files: m.files,
    });
    expect(seeded).toEqual(["a.tsbuildinfo"]);
    expect(m.copies).toEqual([[`/w/new/${C}/a.tsbuildinfo`, `/w/me/${C}/a.tsbuildinfo`]]);
  });

  test("a build info this checkout already has is never overwritten", () => {
    const m = memory({
      [`/w/me/${C}/a.tsbuildinfo`]: 50,
      [`/w/new/${C}/a.tsbuildinfo`]: 300,
    });
    expect(
      seedCache({ root: "/w/me", siblings: ["/w/new"], names: ["a.tsbuildinfo"], files: m.files }),
    ).toEqual([]);
    expect(m.copies).toEqual([]);
  });

  test("a name no sibling has is left for tsc to build", () => {
    const m = memory({ [`/w/new/${C}/a.tsbuildinfo`]: 300 });
    const seeded = seedCache({
      root: "/w/me",
      siblings: ["/w/new"],
      names: ["a.tsbuildinfo", "b.tsbuildinfo"],
      files: m.files,
    });
    expect(seeded).toEqual(["a.tsbuildinfo"]);
  });
});
