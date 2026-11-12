import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  actionOfRoute,
  endMeasure,
  MEASURE_NAMES,
  MEASURES_FLAG,
  startMeasure,
} from "../src/lib/measures.ts";
import { registerDom } from "./dom.ts";

registerDom();

const frames: Array<() => void> = [];
const realRaf = globalThis.requestAnimationFrame;
const flush = () => {
  // Two frames: the first runs after the render, the second after the paint.
  for (let i = 0; i < 2; i++) for (const f of frames.splice(0)) f();
};

beforeEach(() => {
  globalThis.requestAnimationFrame = ((cb: () => void) => frames.push(cb)) as never;
  performance.clearMarks();
  performance.clearMeasures();
});
afterEach(() => {
  globalThis.requestAnimationFrame = realRaf;
  localStorage.removeItem(MEASURES_FLAG);
});

describe("medidas-app: click to paint of the five actions", () => {
  test("the names are fixed", () => {
    expect(MEASURE_NAMES).toEqual({
      "open-session": "fd:open-session",
      "open-board": "fd:open-board",
      "open-card": "fd:open-card",
      send: "fd:send",
      approve: "fd:approve",
    });
  });

  test("with the flag on, each action leaves one measure named for it, and nothing reaches the console", () => {
    localStorage.setItem(MEASURES_FLAG, "1");
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      spyOn(console, m),
    );
    for (const action of Object.keys(MEASURE_NAMES) as Array<keyof typeof MEASURE_NAMES>) {
      startMeasure(action);
      endMeasure(action);
    }
    flush();
    expect(performance.getEntriesByType("measure").map((m) => m.name)).toEqual(
      Object.values(MEASURE_NAMES),
    );
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });

  test("with the flag off, nothing is marked, measured or scheduled", () => {
    startMeasure("send");
    endMeasure("send");
    flush();
    expect(performance.getEntriesByType("mark")).toEqual([]);
    expect(performance.getEntriesByType("measure")).toEqual([]);
    expect(frames).toEqual([]);
  });

  test("an end without a start measures nothing", () => {
    localStorage.setItem(MEASURES_FLAG, "1");
    endMeasure("approve");
    flush();
    expect(performance.getEntriesByType("measure")).toEqual([]);
  });

  test("a storage that throws leaves the measures off", () => {
    // The storage the code reads, whatever DOM another test file registered: its own getItem throws.
    const real = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error("blocked");
        },
      },
    });
    try {
      startMeasure("send");
    } finally {
      if (real) Object.defineProperty(globalThis, "localStorage", real);
    }
    expect(performance.getEntriesByType("mark")).toEqual([]);
  });

  test("a route maps to its action; the other routes are not measured", () => {
    expect(actionOfRoute({ name: "session", host: "h", id: "s" })).toBe("open-session");
    expect(actionOfRoute({ name: "board", host: "h", projectId: "p" })).toBe("open-board");
    expect(actionOfRoute({ name: "card", host: "h", projectId: "p", cardId: "c" })).toBe(
      "open-card",
    );
    expect(actionOfRoute({ name: "hub" })).toBeNull();
  });
});
