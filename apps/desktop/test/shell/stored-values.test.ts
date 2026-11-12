import { describe, expect, test } from "bun:test";
import { SHELL_PREFS_KEY, ShellPrefs } from "../../src/features/shell/shell-prefs.ts";
import { loadFolded, SIDEBAR_FOLDED_KEY } from "../../src/features/shell/sidebar-groups.ts";
import {
  loadTreeFolded,
  loadTreeOpened,
  loadTreePinned,
  TREE_FOLDED_KEY,
  TREE_OPENED_KEY,
  TREE_PINNED_KEY,
} from "../../src/features/shell/tree-fold.ts";

const planted = (key: string, value: string) => ({
  getItem: (asked: string) => (asked === key ? value : null),
  setItem: () => {},
  removeItem: () => {},
});

const NOT_A_LIST = ["null", '{"a":1}', '"work"', "7", "{bad", ""];

describe("what the shell kept on this computer is not trusted (#1609)", () => {
  test("a shell switch is on only when it is stored as true", () => {
    const read = (value: string) => new ShellPrefs(planted(SHELL_PREFS_KEY, value)).value;
    expect(read('{"hideBadges":true,"hideWhatsNew":"true"}')).toEqual({
      hideBadges: true,
      hideWhatsNew: false,
    });
    for (const value of ["null", "[true]", "7", "{bad", '"x"']) {
      expect(read(value)).toEqual({ hideBadges: false, hideWhatsNew: false });
    }
  });

  test("the folded groups are the known ones in their order; the old infra group is machines", () => {
    const read = (value: string) => loadFolded(planted(SIDEBAR_FOLDED_KEY, value));
    expect(read('["library","work","nope",3,null,"infra"]')).toEqual([
      "work",
      "library",
      "machines",
    ]);
    for (const value of NOT_A_LIST) expect(read(value)).toEqual([]);
  });

  test("the folded, opened and pinned projects are the text entries of a stored list", () => {
    const stored = '["h1/p",3,null,"h2/q",{"a":1}]';
    expect(loadTreeFolded(planted(TREE_FOLDED_KEY, stored))).toEqual(["h1/p", "h2/q"]);
    expect(loadTreeOpened(planted(TREE_OPENED_KEY, stored))).toEqual(["h1/p", "h2/q"]);
    expect(loadTreePinned(planted(TREE_PINNED_KEY, stored))).toEqual(["h1/p", "h2/q"]);
    for (const value of NOT_A_LIST) {
      expect(loadTreeFolded(planted(TREE_FOLDED_KEY, value))).toEqual([]);
      expect(loadTreeOpened(planted(TREE_OPENED_KEY, value))).toEqual([]);
      expect(loadTreePinned(planted(TREE_PINNED_KEY, value))).toEqual([]);
    }
  });
});
