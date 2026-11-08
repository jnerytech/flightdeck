import { describe, expect, test } from "bun:test";
import { holdAwake, type Locks } from "../src/lib/keep-awake.ts";

/** Issue #939: the app holds a Web Lock for its life, so a hidden window's page is not frozen. */
describe("keep-awake: a lock held for the app's life (#939)", () => {
  test("it asks for one lock and never lets it go", async () => {
    const names: string[] = [];
    let held: Promise<unknown> | null = null;
    const locks: Locks = {
      request: (name, callback) => {
        names.push(name);
        held = callback();
        return held;
      },
    };
    const taken = holdAwake(locks);
    const state = await Promise.race([
      (held ?? Promise.resolve()).then(() => "released"),
      Promise.resolve().then(() => "held"),
    ]);
    expect([taken, names, state]).toEqual([true, ["flightdeck-awake"], "held"]);
  });

  test("a lock the webview refuses is no error the app sees", async () => {
    let refused: Promise<unknown> = Promise.resolve();
    const locks: Locks = {
      request: (_name, _callback) => {
        refused = Promise.reject(new Error("locks refused"));
        return refused;
      },
    };
    const taken = holdAwake(locks);
    const unhandled = await refused.then(
      () => "kept",
      () => "caught",
    );
    expect([taken, unhandled]).toEqual([true, "caught"]);
  });

  test("a webview without Web Locks is left as it is", () => {
    expect(holdAwake(undefined)).toBe(false);
  });
});
