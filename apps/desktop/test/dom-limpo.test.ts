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
});
