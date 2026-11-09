import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { useState } from "react";
import { liveScreen, registerDom } from "./dom.ts";
import { settle } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { ApprovalCard } = await import("../src/components/approval/approval-card.tsx");
const { TContext } = await import("../src/i18n/context.tsx");
const { translator } = await import("../src/i18n/index.ts");

setDefaultTimeout(30_000);
afterEach(cleanup);
const t = translator("en");

/**
 * #1546 (round 14 of #168): Approve on a card's request removed the button that had the focus and the
 * page body got it. The focus goes to what comes next: the next request waiting, or, with none, the
 * answered request, which says what was decided.
 */
const request = (id: string, tool: string) => ({
  requestId: id,
  toolName: tool,
  input: { command: `${tool} ${id}` },
  cwd: "/w",
  createdAt: null,
});

function Harness(props: Readonly<{ elsewhere?: string[] }>) {
  const [done, setDone] = useState<string[]>([]);
  const answered = [...done, ...(props.elsewhere ?? [])];
  return (
    <TContext.Provider value={t}>
      {[request("r1", "Bash"), request("r2", "Edit")].map((r) => (
        <ApprovalCard
          key={r.requestId}
          request={r}
          t={t}
          nowMs={0}
          {...(answered.includes(r.requestId)
            ? { resolution: { decision: "allow" as const } }
            : {})}
          onRespond={() => setDone((all) => [...all, r.requestId])}
        />
      ))}
    </TContext.Provider>
  );
}

const card = (id: string) =>
  document.querySelector<HTMLElement>(`[data-slot="approval-card"][data-request-id="${id}"]`);
const approveIn = (id: string) =>
  card(id)?.querySelector<HTMLButtonElement>("button:not([disabled])") ?? null;

describe("approval-focus-ui: after Approve the focus goes to what comes next (#1546)", () => {
  test("with another request waiting, it goes to that request", async () => {
    render(<Harness />);
    const first = approveIn("r1");
    expect(first?.textContent).toBe("Approve");
    first?.focus();
    await act(async () => {
      if (first) fireEvent.click(first);
    });
    await settle(() => document.activeElement === card("r2"), 5000, "focus on the next request");
    expect(document.activeElement === card("r2")).toBe(true);
  });

  test("with none waiting, it goes to the request just answered, which says what was decided", async () => {
    render(<Harness />);
    const second = approveIn("r2");
    second?.focus();
    await act(async () => {
      if (second) fireEvent.click(second);
    });
    // r1 still waits, so the first answer goes there; answer it too.
    await settle(() => document.activeElement === card("r1"), 5000, "focus on the other request");
    const first = approveIn("r1");
    first?.focus();
    await act(async () => {
      if (first) fireEvent.click(first);
    });
    await settle(
      () => document.activeElement === card("r1"),
      5000,
      "focus on the answered request",
    );
    expect(document.activeElement?.textContent?.includes("approved")).toBe(true);
  });

  test("a request answered somewhere else takes no focus from where the person is", async () => {
    const { rerender } = render(<Harness />);
    const elsewhere = document.createElement("button");
    document.body.append(elsewhere);
    elsewhere.focus();
    // Another screen answers the first request: only its `resolution` arrives, no click here.
    rerender(<Harness elsewhere={["r1"]} />);
    await act(async () => {});
    const kept = document.activeElement === elsewhere;
    elsewhere.remove();
    expect([kept, card("r1")?.getAttribute("data-state")]).toEqual([true, "answered"]);
  });
});
