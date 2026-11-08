import { afterEach, describe, expect, test } from "bun:test";
import { registerDom } from "./dom.ts";

registerDom();
const { act, cleanup, renderHook } = await import("@testing-library/react");
const { useSessionCost } = await import("../src/lib/use-session-cost.ts");

afterEach(cleanup);

/** A store whose `costs.session` answers `costUsd` (or nothing), recording what it was asked. */
function fake(costUsd: number | null | undefined) {
  const asked: Array<{ host: string; command: string; args: unknown }> = [];
  const store = {
    hostCommand: async (host: string, command: string, args: unknown) => {
      asked.push({ host, command, args });
      return costUsd === undefined ? undefined : { costUsd };
    },
  };
  return { asked, store: store as never };
}

describe("use-session-cost: the cost of one session", () => {
  test("asks the host for the session's cost and gives the figure it sends", async () => {
    const { asked, store } = fake(1.25);
    const { result } = renderHook(() => useSessionCost(store, "h1", "c1", true, "idle"));
    expect(result.current).toBeNull();
    await act(async () => {});
    expect(result.current).toBe(1.25);
    expect(asked).toEqual([
      { host: "h1", command: "costs.session", args: { claudeSessionId: "c1" } },
    ]);
  });

  test.each([
    ["the Claude session is not known yet", undefined, true, "idle"],
    ["the host does not report costs", "c1", false, "idle"],
    ["the session has no status yet", "c1", true, undefined],
  ])("asks nothing while %s", async (_why, claudeId, withCosts, status) => {
    const { asked, store } = fake(2);
    const { result } = renderHook(() => useSessionCost(store, "h1", claudeId, withCosts, status));
    await act(async () => {});
    expect(asked).toEqual([]);
    expect(result.current).toBeNull();
  });

  test("a host with no figure, or none for the session, gives null", async () => {
    for (const answer of [undefined, null]) {
      const { store } = fake(answer);
      const { result } = renderHook(() => useSessionCost(store, "h1", "c1", true, "idle"));
      await act(async () => {});
      expect(result.current).toBeNull();
    }
  });

  test("a new status asks again, and the old figure is dropped until the answer comes", async () => {
    const { asked, store } = fake(0.5);
    const { result, rerender } = renderHook(
      ({ status }) => useSessionCost(store, "h1", "c1", true, status),
      { initialProps: { status: "running" } },
    );
    await act(async () => {});
    expect(result.current).toBe(0.5);
    rerender({ status: "idle" });
    expect(result.current).toBeNull();
    await act(async () => {});
    expect(result.current).toBe(0.5);
    expect(asked).toHaveLength(2);
  });

  test("losing the Claude session clears the figure", async () => {
    const { store } = fake(3);
    const { result, rerender } = renderHook(
      ({ id }: { id: string | undefined }) => useSessionCost(store, "h1", id, true, "idle"),
      { initialProps: { id: "c1" as string | undefined } },
    );
    await act(async () => {});
    expect(result.current).toBe(3);
    rerender({ id: undefined });
    expect(result.current).toBeNull();
  });
});
