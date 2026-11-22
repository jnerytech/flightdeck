import { describe, expect, test } from "bun:test";
import type { DemoIds } from "../../demo-seed.ts";
import { shellShots } from "../../lib/shots/table-shell.ts";

const shot = () => shellShots({} as DemoIds).find((s) => s.name === "atalhos");

/** Runs the print's `prepare` on a page that records each call and answers with itself. */
async function calls(): Promise<string[]> {
  const seen: string[] = [];
  // An options object reads as its values, so a role's name is in the call.
  const text = (arg: unknown): string => {
    if (arg instanceof RegExp || typeof arg === "string") return String(arg);
    if (typeof arg === "object" && arg !== null) return Object.values(arg).map(text).join(",");
    return typeof arg;
  };
  const member = (call: string): unknown =>
    new Proxy(
      (...args: unknown[]) => {
        seen.push(`${call}(${args.map(text).join(",")})`);
        return recorder;
      },
      { get: (_target, prop) => (recorder as Record<string | symbol, unknown>)[prop] },
    );
  const recorder: unknown = new Proxy(() => recorder, {
    // `then` stays undefined, or awaiting the recorder would wait for it forever.
    get: (_target, prop) => (prop === "then" ? undefined : member(String(prop))),
  });
  await shot()?.prepare?.(recorder as never);
  return seen;
}

// #4122: the shortcuts sheet has a print, so axe and the layout checks cover it in both languages.
describe("the shortcuts sheet print (#4122)", () => {
  test("the table prints the sheet on the hub, with the hosts left alone", () => {
    expect(shot()?.route).toEqual({ name: "hub" });
    expect(shot()?.wire).toBeUndefined();
  });

  test("the print opens the sheet with the ? key, as a person does, and waits for it in both languages", async () => {
    const seen = await calls();
    const press = seen.findIndex((c) => c === "press(?)");
    const wait = seen.findIndex((c) => c.includes("Keyboard shortcuts|Atalhos de teclado"));
    expect(press).toBeGreaterThan(-1);
    expect(wait).toBeGreaterThan(press);
  });
});
