import { afterEach, describe, expect, test } from "bun:test";
import type { QuotaHistory } from "@flightdeck/protocol";
import { registerDom } from "../dom.ts";
import { uiIdle, waiter } from "../wait.ts";

registerDom();
const { act, cleanup, render, screen } = await import("@testing-library/react");
const { QuotaPanel } = await import("../../src/features/quota/quota-panel.tsx");
const { projectionText } = await import("../../src/features/quota/domain/quota.ts");
const { TContext } = await import("../../src/i18n/context.tsx");
const { translator } = await import("../../src/i18n/index.ts");

afterEach(cleanup);
const settle = waiter(2000);
const t = translator("en");

const reading = (window: string, utilization: number) => ({
  window,
  utilization,
  resetsAt: null,
  status: "allowed",
  readAt: "2026-11-22T10:00:00.000Z",
});

const history = (window: string): QuotaHistory => ({
  window,
  hours: 5,
  samples: [],
  projection: { exhaustsAt: "2026-11-21T16:00:00.000Z", resetsAt: null, samples: 3 },
  consumers: [],
});

/** One host with the costs feature; its windows change with `readings`, and `refuse` makes `quota.history` answer nothing. */
function rig(windows: ReturnType<typeof reading>[]) {
  const listeners = new Set<() => void>();
  const calls: string[] = [];
  const control = { refuse: false };
  let state = {
    hosts: [{ id: "a", name: "a", status: "online", hostInfo: { features: ["quota", "costs"] } }],
    quota: { a: { windows, pauseAt: 0.9, readAt: "2026-11-22T10:00:00.000Z" } },
    account: {},
  };
  const store = {
    i18n: { t },
    now: () => Date.parse("2026-11-22T10:05:00.000Z"),
    formatTime: () => "16:00",
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getState: () => state,
    hostCommand: async (_host: string, command: string, args: { window: string }) => {
      if (command === "quota.history") calls.push(args.window);
      return control.refuse ? null : history(args.window);
    },
    account: { watch: () => () => undefined },
    router: { push: () => undefined },
    quota: { setPause: async () => true },
  } as never;
  const read = (next: ReturnType<typeof reading>[]) =>
    act(async () => {
      state = { ...state, quota: { a: { ...state.quota.a, windows: next } } };
      for (const fn of listeners) fn();
    });
  return { store, calls, control, read };
}

const view = (store: never) =>
  render(
    <TContext.Provider value={t}>
      <QuotaPanel store={store} />
    </TContext.Provider>,
  );
const line = projectionText("five_hour", history("five_hour").projection, () => "16:00", t);
const region = () => screen.queryByRole("region")?.textContent ?? "";

// #4307: a host with no window asks for no history, and a refused history keeps the line already shown.
describe("the projection lines of the card (#4307)", () => {
  test("a host with no plan window asks for no history", async () => {
    const { store, calls } = rig([]);
    view(store);
    await uiIdle();
    expect(calls).toEqual([]);
  });

  test("a refused history keeps the line the window already had", async () => {
    const first = [reading("five_hour", 0.4), reading("seven_day", 0.4)];
    const { store, calls, control, read } = rig(first);
    view(store);
    await settle(() => region().includes(line));
    control.refuse = true;
    await read([reading("five_hour", 0.5), reading("seven_day", 0.5)]);
    await settle(() => calls.length === 4);
    await uiIdle();
    expect(region().includes(line)).toBe(true);
  });
});
