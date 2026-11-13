import { describe, expect, test } from "bun:test";
import { tabIntent } from "../../src/features/tabs/domain/tab-shortcut.ts";

/** #1605 (Humble Object): what a Ctrl-key asks of the tabs, tested without a store. */
describe("tabIntent", () => {
  test("T opens a new tab, Shift+T brings the last closed one back", () => {
    expect(tabIntent("t", false)).toEqual({ kind: "new" });
    expect(tabIntent("t", true)).toEqual({ kind: "reopen" });
  });

  test("W closes the tab, with or without Shift", () => {
    expect(tabIntent("w", false)).toEqual({ kind: "close" });
    expect(tabIntent("w", true)).toEqual({ kind: "close" });
  });

  test("the backslash splits the view", () => {
    expect(tabIntent("\\", false)).toEqual({ kind: "toggle-split" });
  });

  test("Tab goes to the next host, Shift+Tab to the previous", () => {
    expect(tabIntent("Tab", false)).toEqual({ kind: "next-host" });
    expect(tabIntent("Tab", true)).toEqual({ kind: "previous-host" });
  });

  test("1 to 9 go to that host's tab, but not with Shift, and 0 is none", () => {
    expect(tabIntent("1", false)).toEqual({ kind: "goto-host", n: 1 });
    expect(tabIntent("9", false)).toEqual({ kind: "goto-host", n: 9 });
    expect(tabIntent("3", true)).toBeNull();
    expect(tabIntent("0", false)).toBeNull();
  });

  test("Shift+PageUp moves the tab left, Shift+PageDown right, and neither without Shift", () => {
    expect(tabIntent("PageUp", true)).toEqual({ kind: "move", step: -1 });
    expect(tabIntent("PageDown", true)).toEqual({ kind: "move", step: 1 });
    expect(tabIntent("PageUp", false)).toBeNull();
  });

  test("any other key is none of the tab shortcuts", () => {
    expect(tabIntent("k", false)).toBeNull();
    expect(tabIntent("Enter", true)).toBeNull();
  });
});
