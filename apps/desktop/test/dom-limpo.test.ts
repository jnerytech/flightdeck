import { describe, expect, test } from "bun:test";
import { registerDom } from "./dom.ts";

registerDom();

describe("dom: the browser storage does not carry over from one test file to the next", () => {
  test("registering the DOM again, as the next file does, empties localStorage and sessionStorage", () => {
    localStorage.setItem("flightdeck.hubView", "cards");
    sessionStorage.setItem("flightdeck.tab", "x");
    registerDom();
    expect(localStorage.getItem("flightdeck.hubView")).toBeNull();
    expect(sessionStorage.getItem("flightdeck.tab")).toBeNull();
  });

  test("a file that assigned window.innerWidth does not freeze the viewport for the next one", () => {
    // scripts/test/layout-guards.test.ts does this and runs right before layout.test.tsx in CI:
    // happy-dom's setViewport then no longer reaches matchMedia, so a narrow window never shows.
    (window as unknown as { innerWidth: number }).innerWidth = 1000;
    registerDom();
    (window as unknown as { happyDOM: { setViewport(v: object): void } }).happyDOM.setViewport({
      width: 800,
      height: 800,
    });
    expect(window.innerWidth).toBe(800);
    expect(window.matchMedia("(max-width: 959px)").matches).toBe(true);
    (window as unknown as { happyDOM: { setViewport(v: object): void } }).happyDOM.setViewport({
      width: 1024,
      height: 768,
    });
  });
});
