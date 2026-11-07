import { describe, expect, test } from "bun:test";
import { SIDEBAR_FOLD_KEY, SidebarFoldController } from "../src/lib/sidebar-fold.ts";

/** A storage that keeps what it is given. */
function storage(initial?: string) {
  const kept = new Map<string, string>(initial === undefined ? [] : [[SIDEBAR_FOLD_KEY, initial]]);
  return {
    kept,
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, value),
    removeItem: (key: string) => void kept.delete(key),
  };
}

// Issue #641: the fold of the wide window's sidebar is remembered.
describe("sidebar-fold: the wide sidebar's fold is kept", () => {
  test("it starts unfolded", () => {
    expect(new SidebarFoldController(storage()).folded).toBe(false);
  });

  test("the choice is kept, heard by a listener, and read back by the next window", () => {
    const store = storage();
    const fold = new SidebarFoldController(store);
    let heard = 0;
    const stop = fold.subscribe(() => heard++);
    fold.set(true);
    expect(fold.folded).toBe(true);
    expect(store.kept.get(SIDEBAR_FOLD_KEY)).toBe("true");
    expect(heard).toBe(1);
    expect(new SidebarFoldController(store).folded).toBe(true);
    stop();
    fold.set(false);
    expect(heard).toBe(1);
    expect(new SidebarFoldController(store).folded).toBe(false);
  });

  test("anything else kept there is unfolded", () => {
    expect(new SidebarFoldController(storage("sideways")).folded).toBe(false);
  });
});
