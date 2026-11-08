/** The states of one wand and the one-run gate of the app (issue #158). Pure: time comes in events. */

/** How long "Undo" stays after an Accept. */
export const UNDO_WINDOW_MS = 15_000;

export type WandState =
  | { kind: "idle" }
  /** `sent` is the text the answer is for; `changed` is true when the field moved on meanwhile. */
  | { kind: "running"; requestId: string; sent: string; changed: boolean }
  | {
      kind: "preview";
      original: string;
      proposal: string;
      editing: boolean;
      /** The field no longer holds `original`: Accept asks to confirm. */
      stale: boolean;
      notices: string[];
    }
  | { kind: "failed"; reason: string; params?: Record<string, string | number> }
  /** After Accept: what to put back, what the field must still hold for it, and until when. */
  | { kind: "undo"; before: string; after: string; until: number };

export type WandEvent =
  | { type: "start"; requestId: string; text: string }
  | { type: "answer"; requestId: string; text: string; notices: string[] }
  | {
      type: "fail";
      requestId: string;
      reason: string;
      params?: Record<string, string | number>;
    }
  /** The field's text changed (the person typed, or the app set it). */
  | { type: "field"; text: string }
  | { type: "cancel" }
  | { type: "edit" }
  | { type: "proposal"; text: string }
  | { type: "discard" }
  | { type: "accept"; now: number }
  | { type: "undo" }
  | { type: "tick"; now: number };

type Running = Extract<WandState, { kind: "running" }>;
type Preview = Extract<WandState, { kind: "preview" }>;

/** The run an answer or a failure belongs to; null for any other state or another run. */
function runOf(state: WandState, requestId: string): Running | null {
  return state.kind === "running" && state.requestId === requestId ? state : null;
}

const previewOf = (run: Running, text: string, notices: string[]): Preview => ({
  kind: "preview",
  original: run.sent,
  proposal: text,
  editing: false,
  stale: run.changed,
  notices,
});

/** The message box text changed: what that means depends on what the wand is showing. */
function fieldChanged(state: WandState, text: string): WandState {
  if (state.kind === "running") return { ...state, changed: text !== state.sent };
  if (state.kind === "preview") return { ...state, stale: text !== state.original };
  if (state.kind === "undo" && text !== state.after) return { kind: "idle" };
  return state;
}

/** Accept: the proposal goes in and Undo stays for a while. */
function accepted(state: WandState, now: number): WandState {
  if (state.kind !== "preview") return state;
  return {
    kind: "undo",
    before: state.original,
    after: state.proposal,
    until: now + UNDO_WINDOW_MS,
  };
}

/** Back to idle when the wand is in `kind`; any other state stays as it is. */
function idleFrom(state: WandState, kind: WandState["kind"]): WandState {
  return state.kind === kind ? { kind: "idle" } : state;
}

export function wandReduce(state: WandState, event: WandEvent): WandState {
  switch (event.type) {
    case "start":
      // A run is cancelled before another starts: one at a time.
      if (state.kind === "running") return state;
      return { kind: "running", requestId: event.requestId, sent: event.text, changed: false };
    case "answer": {
      const run = runOf(state, event.requestId);
      return run ? previewOf(run, event.text, event.notices) : state;
    }
    case "fail": {
      if (!runOf(state, event.requestId)) return state;
      return {
        kind: "failed",
        reason: event.reason,
        ...(event.params ? { params: event.params } : {}),
      };
    }
    case "field":
      return fieldChanged(state, event.text);
    case "cancel":
      return idleFrom(state, "running");
    case "edit":
      return state.kind === "preview" ? { ...state, editing: true } : state;
    case "proposal":
      if (state.kind !== "preview" || !state.editing) return state;
      return { ...state, proposal: event.text };
    case "discard":
      return { kind: "idle" };
    case "accept":
      return accepted(state, event.now);
    case "undo":
      return idleFrom(state, "undo");
    case "tick":
      if (state.kind !== "undo" || event.now < state.until) return state;
      return { kind: "idle" };
  }
}

/**
 * One call at a time in the whole app: a wand takes the gate before it runs and gives it back when
 * the answer, the failure or the cancel is in. Whoever does not hold it cannot release it.
 */
export class RunGate {
  private holder: string | null = null;
  private readonly listeners = new Set<(holder: string | null) => void>();

  busy(): boolean {
    return this.holder !== null;
  }

  acquire(id: string): boolean {
    if (this.holder !== null) return false;
    this.holder = id;
    this.emit();
    return true;
  }

  release(id: string): void {
    if (this.holder !== id) return;
    this.holder = null;
    this.emit();
  }

  subscribe(listener: (holder: string | null) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.holder);
  }
}
