import { describe, expect, test } from "bun:test";
import {
  RunGate,
  UNDO_WINDOW_MS,
  type WandEvent,
  type WandState,
  wandReduce,
} from "../src/components/assistant/wand-state.ts";

const IDLE: WandState = { kind: "idle" };
const run = (state: WandState, ...events: WandEvent[]) =>
  events.reduce((current, event) => wandReduce(current, event), state);

const START: WandEvent = { type: "start", requestId: "r1", text: "fix the totl" };
const ANSWER: WandEvent = {
  type: "answer",
  requestId: "r1",
  text: "Fix the total",
  notices: ["n1"],
};

describe("assistant-wand-state: the states of one wand", () => {
  test("start runs with the text as it was sent; an answer for that run becomes a preview", () => {
    const running = run(IDLE, START);
    expect(running).toEqual({
      kind: "running",
      requestId: "r1",
      sent: "fix the totl",
      changed: false,
    });
    expect(run(running, ANSWER)).toEqual({
      kind: "preview",
      original: "fix the totl",
      proposal: "Fix the total",
      editing: false,
      stale: false,
      notices: ["n1"],
    });
  });

  test("an answer for an older run, or when nothing runs, is dropped", () => {
    const running = run(IDLE, START);
    expect(run(running, { ...ANSWER, requestId: "old" })).toEqual(running);
    expect(run(IDLE, ANSWER)).toEqual(IDLE);
    const previewed = run(running, ANSWER);
    expect(run(previewed, { ...ANSWER, text: "other" })).toEqual(previewed);
  });

  test("cancel drops the run, and the answer that comes after it is ignored", () => {
    const cancelled = run(IDLE, START, { type: "cancel" });
    expect(cancelled).toEqual(IDLE);
    expect(run(cancelled, ANSWER)).toEqual(IDLE);
  });

  test("a failure of the run becomes failed with its reason and params; one of an older run is ignored", () => {
    const running = run(IDLE, START);
    expect(
      run(running, { type: "fail", requestId: "r1", reason: "assistant_credits", params: {} }),
    ).toEqual({ kind: "failed", reason: "assistant_credits", params: {} });
    expect(run(running, { type: "fail", requestId: "old", reason: "assistant_credits" })).toEqual(
      running,
    );
  });

  test("typing while it runs marks the answer as for an older text: the preview is stale", () => {
    const typed = run(IDLE, START, { type: "field", text: "fix the total, please" });
    expect(typed).toEqual({
      kind: "running",
      requestId: "r1",
      sent: "fix the totl",
      changed: true,
    });
    const previewed = run(typed, ANSWER);
    expect(previewed.kind === "preview" && previewed.stale).toBe(true);
    // Typing the sent text back clears it.
    expect(run(typed, { type: "field", text: "fix the totl" })).toEqual(run(IDLE, START));
  });

  test("typing under a preview makes it stale too, and typing the original back clears that", () => {
    const previewed = run(IDLE, START, ANSWER);
    const typed = run(previewed, { type: "field", text: "fix the total" });
    expect(typed.kind === "preview" && typed.stale).toBe(true);
    const back = run(typed, { type: "field", text: "fix the totl" });
    expect(back.kind === "preview" && back.stale).toBe(false);
  });

  test("edit turns the proposal into text to change; the edit is kept; retry runs again from the original", () => {
    const edited = run(
      IDLE,
      START,
      ANSWER,
      { type: "edit" },
      { type: "proposal", text: "Fix the total!" },
    );
    expect(edited).toMatchObject({ kind: "preview", editing: true, proposal: "Fix the total!" });
    expect(run(edited, { type: "start", requestId: "r2", text: "fix the totl" })).toEqual({
      kind: "running",
      requestId: "r2",
      sent: "fix the totl",
      changed: false,
    });
  });

  test("discard goes back to idle without a trace", () => {
    expect(run(IDLE, START, ANSWER, { type: "discard" })).toEqual(IDLE);
    expect(run(IDLE, START, { type: "discard" })).toEqual(IDLE);
  });

  test("accept keeps what to put back for fifteen seconds, and the proposal is what was edited", () => {
    const accepted = run(IDLE, START, ANSWER, { type: "accept", now: 1000 });
    expect(accepted).toEqual({
      kind: "undo",
      before: "fix the totl",
      after: "Fix the total",
      until: 1000 + UNDO_WINDOW_MS,
    });
    expect(UNDO_WINDOW_MS).toBe(15_000);
    const edited = run(
      IDLE,
      START,
      ANSWER,
      { type: "edit" },
      { type: "proposal", text: "Mine" },
      { type: "accept", now: 5 },
    );
    expect(edited).toMatchObject({ kind: "undo", after: "Mine" });
    // Accept outside a preview does nothing.
    expect(run(IDLE, { type: "accept", now: 1 })).toEqual(IDLE);
  });

  test("the undo window ends with the clock, with any other typing, and after an Undo", () => {
    const undo = run(IDLE, START, ANSWER, { type: "accept", now: 0 });
    expect(run(undo, { type: "tick", now: UNDO_WINDOW_MS - 1 })).toEqual(undo);
    expect(run(undo, { type: "tick", now: UNDO_WINDOW_MS })).toEqual(IDLE);
    // The field still equals the accepted text: the undo stays. Anything else drops it.
    expect(run(undo, { type: "field", text: "Fix the total" })).toEqual(undo);
    expect(run(undo, { type: "field", text: "Fix the total." })).toEqual(IDLE);
    expect(run(undo, { type: "undo" })).toEqual(IDLE);
  });

  test("start from a preview, a failure or an undo begins a new run", () => {
    for (const from of [
      run(IDLE, START, ANSWER),
      run(IDLE, START, { type: "fail", requestId: "r1", reason: "assistant_offline" }),
      run(IDLE, START, ANSWER, { type: "accept", now: 0 }),
    ]) {
      expect(run(from, { type: "start", requestId: "r9", text: "t" })).toEqual({
        kind: "running",
        requestId: "r9",
        sent: "t",
        changed: false,
      });
    }
  });
});

describe("assistant-wand-state: one run at a time in the app", () => {
  test("a second wand cannot start while one runs; it can when the first lets go", () => {
    const gate = new RunGate();
    const seen: Array<string | null> = [];
    gate.subscribe((id) => void seen.push(id));
    expect(gate.busy()).toBe(false);
    expect(gate.acquire("a")).toBe(true);
    expect(gate.busy()).toBe(true);
    expect(gate.acquire("b")).toBe(false);
    // Only the holder can let go.
    gate.release("b");
    expect(gate.busy()).toBe(true);
    gate.release("a");
    expect(gate.busy()).toBe(false);
    expect(gate.acquire("b")).toBe(true);
    expect(seen).toEqual(["a", null, "b"]);
  });
});
