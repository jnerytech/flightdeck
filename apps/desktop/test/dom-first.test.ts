import { describe, expect, test } from "bun:test";

/**
 * #2006: a desktop test file that never calls `registerDom()` still finds a DOM when it starts, so
 * the app store it imports loads the UI libraries with `document` in place. Run after
 * `abrir-resultado.test.ts` (no DOM of its own) the account menu could not open before this.
 */
describe("dom-first: the desktop tests start with a DOM", () => {
  test("document and window exist before this file imports anything", () => {
    expect([typeof document, typeof window]).toEqual(["object", "object"]);
  });
});
