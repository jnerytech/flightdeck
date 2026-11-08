import { describe, expect, test } from "bun:test";
import { holdAwake, type Locks } from "../src/lib/keep-awake.ts";

/** Issue #939: the app holds a Web Lock for its life, so a hidden window's page is not frozen. */
describe("keep-awake: a lock held for the app's life (#939)", () => {
  test("it asks for one shared lock and never lets it go", async () => {
    const asked: Array<[string, unknown]> = [];
    let held: Promise<unknown> | null = null;
    const locks: Locks = {
      request: (name, options, callback) => {
        asked.push([name, options]);
        held = callback();
        return held;
      },
    };
    const taken = holdAwake(locks, () => {});
    const state = await Promise.race([
      (held ?? Promise.resolve()).then(() => "released"),
      Promise.resolve().then(() => "held"),
    ]);
    expect([taken, asked, state]).toEqual([
      true,
      [["flightdeck-awake", { mode: "shared" }]],
      "held",
    ]);
  });

  test("a lock the webview refuses, later or at once, is told to the log and never stops the app", async () => {
    const errors: unknown[] = [];
    const later: Locks = { request: () => Promise.reject(new Error("refused later")) };
    const atOnce: Locks = {
      request: () => {
        throw new Error("refused at once");
      },
    };
    const take = (locks: Locks) => {
      try {
        return holdAwake(locks, (e) => errors.push(e));
      } catch {
        return "threw";
      }
    };
    const taken = [take(later), take(atOnce)];
    await Promise.resolve();
    await Promise.resolve();
    expect([taken, errors.map((e) => (e as Error).message).sort()]).toEqual([
      [true, false],
      ["refused at once", "refused later"],
    ]);
  });

  test("a webview without Web Locks is left as it is", () => {
    expect(holdAwake(undefined, () => {})).toBe(false);
  });
});
