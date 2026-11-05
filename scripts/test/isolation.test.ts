import { describe, expect, test } from "bun:test";
import { registerDom } from "../../apps/desktop/test/dom.ts";
import { captureGlobals, restoreGlobals, type Scope } from "./isolation.ts";

registerDom();

/** A stand-in for `globalThis`: the members the isolation looks at, and an environment. */
function fakeScope(): Scope {
  return {
    process: { env: { KEPT: "1", CHANGED: "before" } },
    setTimeout: () => "real setTimeout",
    clearTimeout: () => undefined,
    setInterval: () => "real setInterval",
    clearInterval: () => undefined,
    Date: class RealDate {},
    fetch: () => "real fetch",
  };
}

describe("isolation: what a file leaves in the globals is put back before the next file", () => {
  test("a file that left no change leaves nothing to restore", () => {
    const scope = fakeScope();
    const snapshot = captureGlobals(scope);
    expect(restoreGlobals(snapshot, scope)).toEqual([]);
  });

  test("a timer a file replaced and never put back is the real one again, and is named", () => {
    const scope = fakeScope();
    const real = scope.setTimeout;
    const snapshot = captureGlobals(scope);
    scope.setTimeout = () => "fake setTimeout";
    scope.setInterval = () => "fake setInterval";
    expect(restoreGlobals(snapshot, scope).sort()).toEqual(["setInterval", "setTimeout"]);
    expect(scope.setTimeout).toBe(real);
    expect(scope.setInterval()).toBe("real setInterval");
  });

  test("a fake Date and a fake fetch come back as the real ones", () => {
    const scope = fakeScope();
    const { Date: RealDate, fetch } = scope;
    const snapshot = captureGlobals(scope);
    scope.Date = class FakeDate {};
    scope.fetch = () => "mock";
    expect(restoreGlobals(snapshot, scope).sort()).toEqual(["Date", "fetch"]);
    expect(scope.Date).toBe(RealDate);
    expect(scope.fetch).toBe(fetch);
  });

  test("an environment variable a file added, changed or removed is back as it was", () => {
    const scope = fakeScope();
    const snapshot = captureGlobals(scope);
    scope.process.env.ADDED = "x";
    scope.process.env.CHANGED = "after";
    delete scope.process.env.KEPT;
    expect(restoreGlobals(snapshot, scope).sort()).toEqual([
      "env.ADDED",
      "env.CHANGED",
      "env.KEPT",
    ]);
    expect(scope.process.env).toEqual({ KEPT: "1", CHANGED: "before" });
  });

  test("a snapshot is a copy: the environment changed after it does not change it", () => {
    const scope = fakeScope();
    const snapshot = captureGlobals(scope);
    scope.process.env.CHANGED = "after";
    expect(snapshot.env.CHANGED).toBe("before");
  });

  test("a window size a file assigned stops freezing the viewport, and is named", () => {
    const happy = (window as unknown as { happyDOM: { setViewport(v: object): void } }).happyDOM;
    const snapshot = captureGlobals();
    (window as unknown as { innerWidth: number }).innerWidth = 1000;
    expect(restoreGlobals(snapshot)).toContain("innerWidth");
    happy.setViewport({ width: 800, height: 600 });
    expect(window.innerWidth).toBe(800);
    expect(window.matchMedia("(max-width: 959px)").matches).toBe(true);
    happy.setViewport({ width: 1024, height: 768 });
  });

  test("the browser storage and the page body a file filled are empty again, and named", () => {
    const snapshot = captureGlobals();
    localStorage.setItem("flightdeck.hubView", "cards");
    sessionStorage.setItem("flightdeck.tab", "x");
    document.body.innerHTML = "<p>left behind</p>";
    expect(restoreGlobals(snapshot).sort()).toEqual([
      "document.body",
      "localStorage",
      "sessionStorage",
    ]);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(document.body.innerHTML).toBe("");
  });
});
