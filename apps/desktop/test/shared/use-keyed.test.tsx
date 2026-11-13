import { afterEach, describe, expect, test } from "bun:test";
import { useKeyed } from "../../src/shared/hooks/use-keyed.ts";
import { registerDom } from "../dom.ts";

registerDom();
const { cleanup, renderHook } = await import("@testing-library/react");

afterEach(cleanup);

/** Issue #1609: an effect keyed on a value that is rebuilt each render runs only when its content changes. */
describe("use-keyed: the same value while its content is the same", () => {
  test("a new array with the same content gives back the first one; other content gives the new one", () => {
    const { result, rerender } = renderHook(({ value }) => useKeyed(value), {
      initialProps: { value: [["host", ["a"]]] as Array<[string, string[]]> },
    });
    const first = result.current;
    rerender({ value: [["host", ["a"]]] });
    const sameContent = result.current === first;
    rerender({ value: [["host", ["a", "b"]]] });
    expect([sameContent, result.current]).toEqual([true, [["host", ["a", "b"]]]]);
  });
});
