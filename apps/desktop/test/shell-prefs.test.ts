import { describe, expect, test } from "bun:test";
import { SHELL_PREFS_KEY, ShellPrefs } from "../src/lib/shell-prefs.ts";

/** A storage that keeps what it is given. */
function storage(initial?: string) {
  const kept = new Map<string, string>(initial === undefined ? [] : [[SHELL_PREFS_KEY, initial]]);
  return {
    kept,
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, value),
    removeItem: (key: string) => void kept.delete(key),
  };
}

// Issue #282: the account menu's switches for badges and What's new are kept on this computer.
describe("shell-prefs: what the shell hides is kept", () => {
  test("nothing is hidden at first", () => {
    expect(new ShellPrefs(storage()).value).toEqual({ hideBadges: false, hideWhatsNew: false });
  });

  test("a switch is kept, heard by a listener, and read back by the next window", () => {
    const store = storage();
    const prefs = new ShellPrefs(store);
    let heard = 0;
    const stop = prefs.subscribe(() => heard++);
    const before = prefs.value;
    prefs.set({ hideBadges: true });
    expect(prefs.value).toEqual({ hideBadges: true, hideWhatsNew: false });
    expect(prefs.value === before).toBe(false);
    expect(heard).toBe(1);
    expect(new ShellPrefs(store).value).toEqual({ hideBadges: true, hideWhatsNew: false });
    prefs.set({ hideWhatsNew: true });
    expect(new ShellPrefs(store).value).toEqual({ hideBadges: true, hideWhatsNew: true });
    stop();
    prefs.set({ hideBadges: false });
    expect(heard).toBe(2);
  });

  test("anything unreadable kept there hides nothing", () => {
    expect(new ShellPrefs(storage("{nope")).value).toEqual({
      hideBadges: false,
      hideWhatsNew: false,
    });
    expect(new ShellPrefs(storage('{"hideBadges":"yes"}')).value).toEqual({
      hideBadges: false,
      hideWhatsNew: false,
    });
  });
});
