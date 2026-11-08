import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import type { ComponentType } from "react";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { scaleState, summaryBurst } from "./scale-fixture.ts";

registerDom();
const { act, cleanup, render } = await import("@testing-library/react");

/**
 * Issue #1191: at 200 sessions on 4 hosts, a burst of summaries of one session redraws the rows of
 * Needs you whose entry changed, not every row. The rows' module is wrapped to count how often a
 * row renders; the wrapper keeps the row's own memo, so a row that is not memoized counts every
 * render of the list.
 */
const ROWS = "../src/components/needs-you/entry-row.tsx";
const real = await import(ROWS);
let renders = 0;
type Row =
  | ComponentType<Record<string, unknown>>
  | { type: ComponentType<Record<string, unknown>> };
const counting =
  (inner: (props: Record<string, unknown>) => unknown) => (props: Record<string, unknown>) => {
    renders += 1;
    return inner(props);
  };
const row = real.EntryRow as Row;
const EntryRow =
  typeof row === "object" && "type" in row
    ? { ...row, type: counting(row.type as never) }
    : counting(row as never);
mock.module(ROWS, () => ({ ...real, EntryRow }));
afterAll(() => {
  mock.module(ROWS, () => real);
});

const { AppStore } = await import("../src/lib/app-store.ts");
const { useStoreState } = await import("../src/lib/use-store.ts");
const { NeedsYou } = await import("../src/ui/NeedsYou.tsx");

afterEach(cleanup);

const BURST = 10;

function Page(props: Readonly<{ store: InstanceType<typeof AppStore> }>) {
  const state = useStoreState(props.store);
  return <NeedsYou store={props.store} state={state} go={() => {}} onOpenRequest={() => {}} />;
}

describe("scale-needs-you: a burst of one session's summaries at 200 sessions (#1191)", () => {
  test("redraws only the rows whose entry changed, not every waiting request", () => {
    const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 600_000 });
    const hidden = store as unknown as {
      state: Record<string, unknown>;
      onEvent(hostId: string, envelope: unknown): void;
    };
    hidden.state = { ...store.getState(), ...scaleState({ hosts: 4, perHost: 50 }) };
    render(<Page store={store} />);
    const first = renders;
    renders = 0;
    for (const envelope of summaryBurst(0, 0, BURST)) {
      act(() => hidden.onEvent("host-0", envelope));
    }
    // Each summary may add or change the session's own row (a finished line): three per summary
    // at most, whatever the number of sessions.
    expect({ first: first > 40, burst: renders, underBudget: renders <= 3 * BURST }).toEqual({
      first: true,
      burst: renders,
      underBudget: true,
    });
    store.dispose();
  });
});
