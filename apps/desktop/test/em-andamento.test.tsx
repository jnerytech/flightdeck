import { afterEach, describe, expect, test } from "bun:test";
import { IN_FLIGHT, InFlightTimers, inFlightStage } from "../src/hooks/use-in-flight.ts";
import { useMinLoading } from "../src/hooks/use-min-loading.ts";
import { translator } from "../src/i18n/index.ts";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
const { act, cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { ActionButton } = await import("../src/components/feedback/action-button.tsx");
const { FormActions } = await import("../src/components/layout/form.tsx");
const { LoadingState } = await import("../src/components/layout/states.tsx");
const { TContext } = await import("../src/i18n/context.tsx");

afterEach(cleanup);

/** A clock the test drives: timers fire when `advance` passes their time. */
function clock() {
  let t = 0;
  const pending: Array<{ at: number; fn: () => void; handle: number; live: boolean }> = [];
  const timers = {
    now: () => t,
    setTimeout: (fn: () => void, ms: number) => {
      const entry = { at: t + ms, fn, handle: pending.length, live: true };
      pending.push(entry);
      return entry.handle;
    },
    clearTimeout: (handle: unknown) => {
      const entry = pending[handle as number];
      if (entry) entry.live = false;
    },
  };
  const advance = async (ms: number) => {
    t += ms;
    await act(async () => {
      for (const entry of pending) {
        if (entry.live && entry.at <= t) {
          entry.live = false;
          entry.fn();
        }
      }
    });
  };
  return { timers, advance };
}

const inApp = (clk: ReturnType<typeof clock>, ui: React.ReactNode) => (
  <TContext.Provider value={translator("en")}>
    <InFlightTimers.Provider value={clk.timers}>{ui}</InFlightTimers.Provider>
  </TContext.Provider>
);
const button = (name: RegExp | string) => screen.getByRole("button", { name }) as HTMLButtonElement;

describe("in-flight feedback by duration (issue #240)", () => {
  test("the rule: nothing under 100 ms, disabled to 1 s, a spinner from 1 s, a stage label from 3 s", () => {
    expect(IN_FLIGHT).toEqual({ quietMs: 100, spinnerMs: 1000, slowMs: 3000, deferMs: 200 });
    expect(inFlightStage(0)).toBe("quiet");
    expect(inFlightStage(99)).toBe("quiet");
    expect(inFlightStage(100)).toBe("pending");
    expect(inFlightStage(999)).toBe("pending");
    expect(inFlightStage(1000)).toBe("spinner");
    expect(inFlightStage(2999)).toBe("spinner");
    expect(inFlightStage(3000)).toBe("slow");
  });

  test("a pending button is busy and ignores clicks at once, but shows nothing new until 100 ms, no spinner until 1 s", async () => {
    const clk = clock();
    render(inApp(clk, <ActionButton pending>Save</ActionButton>));
    const save = button(/Save/);
    expect(save.getAttribute("aria-busy")).toBe("true");
    expect(save.disabled).toBe(true);
    expect(save.getAttribute("data-feedback")).toBe("quiet");
    expect(save.querySelector("svg.animate-spin")).toBeNull();
    await clk.advance(100);
    expect(save.getAttribute("data-feedback")).toBe("pending");
    expect(save.querySelector("svg.animate-spin")).toBeNull();
    await clk.advance(900);
    expect(save.getAttribute("data-feedback")).toBe("spinner");
    expect(save.querySelector("svg.animate-spin")).not.toBeNull();
    expect(screen.queryByText("Still working…")).toBeNull();
  });

  test("after 3 s the button says it is still working, or the stage the caller names", async () => {
    const clk = clock();
    render(inApp(clk, <ActionButton pending>Save</ActionButton>));
    await clk.advance(3000);
    expect(button(/Save/).getAttribute("data-feedback")).toBe("slow");
    expect(screen.queryByText("Still working…")).not.toBeNull();
    cleanup();
    const other = clock();
    render(
      inApp(
        other,
        <ActionButton pending stageLabel="Uploading 2 of 5…">
          Send
        </ActionButton>,
      ),
    );
    await other.advance(3000);
    expect(screen.queryByText("Uploading 2 of 5…")).not.toBeNull();
    expect(screen.queryByText("Still working…")).toBeNull();
  });

  test("when the work ends the button goes back to idle with no spinner and no stage text", async () => {
    const clk = clock();
    const view = render(inApp(clk, <ActionButton pending>Save</ActionButton>));
    await clk.advance(3500);
    view.rerender(inApp(clk, <ActionButton>Save</ActionButton>));
    const save = button(/Save/);
    expect(save.getAttribute("data-feedback")).toBeNull();
    expect(save.getAttribute("aria-busy")).toBeNull();
    expect(save.querySelector("svg.animate-spin")).toBeNull();
    expect(screen.queryByText("Still working…")).toBeNull();
  });

  test("a form's busy submit follows the same rule", async () => {
    const clk = clock();
    render(inApp(clk, <FormActions submit="Create" busy />));
    const create = button(/Create/);
    expect(create.getAttribute("aria-busy")).toBe("true");
    expect(create.querySelector("svg.animate-spin")).toBeNull();
    await clk.advance(1000);
    expect(create.querySelector("svg.animate-spin")).not.toBeNull();
    await clk.advance(2000);
    expect(screen.queryByText("Still working…")).not.toBeNull();
  });

  test("a loading panel announces itself at once but draws its placeholders only after 200 ms", async () => {
    const clk = clock();
    render(inApp(clk, <LoadingState label="Loading sessions" />));
    expect(screen.getByRole("status", { name: "Loading sessions" })).toBeTruthy();
    expect(document.querySelectorAll("[data-slot='skeleton']")).toHaveLength(0);
    await clk.advance(199);
    expect(document.querySelectorAll("[data-slot='skeleton']")).toHaveLength(0);
    await clk.advance(1);
    expect(document.querySelectorAll("[data-slot='skeleton']").length).toBeGreaterThan(0);
  });
});

/** `useMinLoading` on a test clock, as the screens use it. */
function MinProbe(props: { loading: boolean; timers: ReturnType<typeof clock>["timers"] }) {
  return <p>{useMinLoading(props.loading, props.timers) ? "loading" : "ready"}</p>;
}

describe("the minimum time counts from when the placeholders are drawn (issue #240)", () => {
  test("a load that ends before 200 ms is gone at once: its placeholders were never drawn", async () => {
    const clk = clock();
    const view = render(<MinProbe loading timers={clk.timers} />);
    await clk.advance(50);
    view.rerender(<MinProbe loading={false} timers={clk.timers} />);
    await clk.advance(0);
    expect(screen.queryByText("ready")).not.toBeNull();
  });

  test("a load that ends at 250 ms keeps the placeholders until they have been drawn for 150 ms", async () => {
    const clk = clock();
    const view = render(<MinProbe loading timers={clk.timers} />);
    await clk.advance(250);
    view.rerender(<MinProbe loading={false} timers={clk.timers} />);
    expect(screen.queryByText("loading")).not.toBeNull();
    await clk.advance(99);
    expect(screen.queryByText("loading")).not.toBeNull();
    await clk.advance(1);
    expect(screen.queryByText("ready")).not.toBeNull();
  });
});
