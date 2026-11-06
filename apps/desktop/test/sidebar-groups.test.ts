import { describe, expect, test } from "bun:test";
import { loadFolded, SIDEBAR_FOLDED_KEY, saveFolded } from "../src/lib/sidebar-groups.ts";

const storageWith = (value: string | null) => ({
  getItem: (key: string) => (key === SIDEBAR_FOLDED_KEY ? value : null),
});

describe("sidebar-groups: the folded groups kept between runs", () => {
  test("nothing stored means no group is folded", () => {
    expect(loadFolded(storageWith(null))).toEqual([]);
  });

  test("only known groups come back, in the sidebar's order", () => {
    expect(loadFolded(storageWith('["infra","made-up","machines","work"]'))).toEqual([
      "work",
      "machines",
    ]);
  });

  test("a group folded under its old name (infra) is read as Machines, once (SG-m3)", () => {
    expect(loadFolded(storageWith('["infra"]'))).toEqual(["machines"]);
    expect(loadFolded(storageWith('["infra","machines"]'))).toEqual(["machines"]);
  });

  test("text that is not JSON is read as none folded", () => {
    expect(loadFolded(storageWith("{not json"))).toEqual([]);
  });

  test("JSON that is not a list is read as none folded", () => {
    expect(loadFolded(storageWith('{"work":true}'))).toEqual([]);
  });

  test("what is saved is what is loaded again", () => {
    const written = new Map<string, string>();
    saveFolded({ setItem: (key, value) => void written.set(key, value) }, ["library"]);
    expect(loadFolded(storageWith(written.get(SIDEBAR_FOLDED_KEY) ?? null))).toEqual(["library"]);
  });
});
