import { afterEach, describe, expect, test } from "bun:test";
import { IN_FLIGHT } from "../src/hooks/use-in-flight.ts";
import { MIN_LOADING_MS, useMinLoading } from "../src/hooks/use-min-loading.ts";
import { registerDom } from "./dom.ts";
import { settle } from "./wait.ts";

registerDom();
const { cleanup, renderHook } = await import("@testing-library/react");

afterEach(cleanup);

/** The real clock is the subject here: the placeholders are drawn once `deferMs` has passed. */
const placeholdersDrawn = () =>
  // timing: the hook's own real clock decides when the placeholders count as drawn
  new Promise((resolve) => setTimeout(resolve, IN_FLIGHT.deferMs + 30));

describe("min-loading-real: the hook on the real timers", () => {
  test("a load that drew its placeholders holds them for the minimum, then lets go", async () => {
    const { result, rerender } = renderHook(({ loading }) => useMinLoading(loading), {
      initialProps: { loading: true },
    });
    await placeholdersDrawn();
    rerender({ loading: false });
    expect(result.current).toBe(true);
    await settle(() => result.current === false, MIN_LOADING_MS * 10);
  });

  test("a hold still running when the screen goes away is cancelled with it", async () => {
    const { result, rerender, unmount } = renderHook(({ loading }) => useMinLoading(loading), {
      initialProps: { loading: true },
    });
    await placeholdersDrawn();
    rerender({ loading: false });
    expect(result.current).toBe(true);
    unmount();
    expect(result.current).toBe(true);
  });
});
