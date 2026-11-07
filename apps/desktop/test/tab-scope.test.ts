import { describe, expect, test } from "bun:test";
import { TAB_SCOPE_KEY, TabScopeController } from "../src/lib/tab-scope.ts";

/** A storage that keeps what it is given. */
function storage(initial?: string) {
  const kept = new Map<string, string>(initial === undefined ? [] : [[TAB_SCOPE_KEY, initial]]);
  return {
    kept,
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, value),
    removeItem: (key: string) => void kept.delete(key),
  };
}

// Issue #644: the tab row can show every host's tabs, grouped by host; the choice is kept.
describe("tab-scope: one host's tabs, or every host's", () => {
  test("it starts on the current host's tabs", () => {
    expect(new TabScopeController(storage()).value).toBe("host");
  });

  test("the choice is kept and read back by the next window", () => {
    const store = storage();
    const scope = new TabScopeController(store);
    let heard = 0;
    scope.subscribe(() => heard++);
    scope.set("all");
    expect(scope.value).toBe("all");
    expect(store.kept.get(TAB_SCOPE_KEY)).toBe("all");
    expect(heard).toBe(1);
    expect(new TabScopeController(store).value).toBe("all");
    scope.set("host");
    expect(new TabScopeController(store).value).toBe("host");
  });

  test("anything else kept there is the current host's tabs", () => {
    expect(new TabScopeController(storage("everything")).value).toBe("host");
  });
});
