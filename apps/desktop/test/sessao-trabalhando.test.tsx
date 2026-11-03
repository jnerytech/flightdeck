import { afterEach, describe, expect, test } from "bun:test";
import type { EventEnvelope, SessionEvent } from "@flightdeck/protocol";
import { badgePulses } from "../src/lib/tab-badge.ts";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
const { cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { SessionView } = await import("../src/ui/SessionView.tsx");
const { applyEnvelope, emptySession } = await import("../src/lib/session-state.ts");

afterEach(cleanup);

const env = (seq: number, event: SessionEvent, ts = "2026-11-03T10:00:00.000Z"): EventEnvelope => ({
  type: "event",
  sessionId: "s",
  seq,
  ts,
  event,
});
const actions = {
  send: async () => {},
  interrupt: async () => {},
  close: async () => {},
  resume: async () => {},
  respond: async () => {},
};
const NOW = Date.parse("2026-11-03T10:00:12.000Z");

describe("sessao-trabalhando: the conversation shows that Claude is working", () => {
  test("the state notes when the turn began; it keeps that through a permission and clears when idle", () => {
    let s = applyEnvelope(emptySession(), env(1, { type: "session.status", status: "running" }));
    expect(s.busySince).toBe(Date.parse("2026-11-03T10:00:00.000Z"));
    s = applyEnvelope(
      s,
      env(2, { type: "session.status", status: "awaiting_permission" }, "2026-11-03T10:00:05.000Z"),
    );
    s = applyEnvelope(
      s,
      env(3, { type: "session.status", status: "running" }, "2026-11-03T10:00:06.000Z"),
    );
    expect(s.busySince).toBe(Date.parse("2026-11-03T10:00:00.000Z"));
    s = applyEnvelope(s, env(4, { type: "session.status", status: "idle" }));
    expect(s.busySince).toBeUndefined();
  });

  test("while a turn runs the last row says Working, for how long and with which tool", () => {
    const session = {
      ...emptySession(),
      status: "running" as const,
      busySince: NOW - 12_000,
      items: [
        {
          kind: "assistant" as const,
          seq: 1,
          blocks: [{ type: "tool_use" as const, id: "t1", name: "Bash", input: {} }],
        },
      ],
    };
    render(<SessionView title="s" session={session} actions={actions} nowMs={NOW} />);
    const row = screen.queryByRole("status", { name: "Trabalhando…" });
    expect(row).not.toBeNull();
    expect(row?.getAttribute("aria-live")).toBe("polite");
    expect(row?.textContent).toContain("12s");
    expect(row?.textContent).toContain("Bash");
  });

  test("a tool that already answered is not named; a session waiting or idle shows no row", () => {
    const answered = {
      ...emptySession(),
      status: "running" as const,
      busySince: NOW - 3000,
      toolResults: { t1: { content: "", isError: false } },
      items: [
        {
          kind: "assistant" as const,
          seq: 1,
          blocks: [{ type: "tool_use" as const, id: "t1", name: "Bash", input: {} }],
        },
      ],
    };
    const { rerender } = render(
      <SessionView title="s" session={answered} actions={actions} nowMs={NOW} />,
    );
    const row = screen.queryByRole("status", { name: "Trabalhando…" });
    expect(row?.textContent).toContain("3s");
    expect(row?.textContent).not.toContain("Bash");
    rerender(
      <SessionView
        title="s"
        session={{ ...answered, status: "awaiting_permission" }}
        actions={actions}
        nowMs={NOW}
      />,
    );
    expect(screen.queryByRole("status", { name: "Trabalhando…" })).toBeNull();
    rerender(<SessionView title="s" session={{ ...answered, status: "idle" }} actions={actions} />);
    expect(screen.queryByRole("status", { name: "Trabalhando…" })).toBeNull();
  });

  test("a running tab pulses; the others do not", () => {
    expect(badgePulses("running")).toBe(true);
    expect(badgePulses("needs-you")).toBe(false);
    expect(badgePulses("unread")).toBe(false);
    expect(badgePulses(null)).toBe(false);
  });
});
