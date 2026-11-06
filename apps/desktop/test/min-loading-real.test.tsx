import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { IN_FLIGHT } from "../src/hooks/use-in-flight.ts";
import { MIN_LOADING_MS, useMinLoading } from "../src/hooks/use-min-loading.ts";
import { registerDom } from "./dom.ts";
import { settle } from "./wait.ts";

registerDom();
const { cleanup, renderHook } = await import("@testing-library/react");

afterEach(cleanup);

/**
 * The hook's default timers are the real ones: its clock is `performance.now`, which the test
 * drives, and a hold that is left with one millisecond runs on the real `setTimeout`.
 */
function atTime() {
  let now = 0;
  const spy = spyOn(performance, "now").mockImplementation(() => now);
  return {
    /** Placeholders drawn for all of the minimum but one millisecond. */
    almostHeld: () => {
      now = IN_FLIGHT.deferMs + MIN_LOADING_MS - 1;
    },
    restore: () => spy.mockRestore(),
  };
}

describe("min-loading-real: the hook on its default timers", () => {
  test("a load that drew its placeholders holds them for what is left of the minimum, then lets go", async () => {
    const time = atTime();
    try {
      const { result, rerender } = renderHook(({ loading }) => useMinLoading(loading), {
        initialProps: { loading: true },
      });
      time.almostHeld();
      rerender({ loading: false });
      expect(result.current).toBe(true);
      await settle(() => result.current === false);
    } finally {
      time.restore();
    }
  });

  test("a hold still running when the screen goes away is cancelled with it", () => {
    const time = atTime();
    try {
      const { result, rerender, unmount } = renderHook(({ loading }) => useMinLoading(loading), {
        initialProps: { loading: true },
      });
      time.almostHeld();
      rerender({ loading: false });
      expect(result.current).toBe(true);
      unmount();
    } finally {
      time.restore();
    }
  });
});
