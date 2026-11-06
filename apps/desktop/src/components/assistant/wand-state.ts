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

export function wandReduce(state: WandState, event: WandEvent): WandState {
  switch (event.type) {
    case "start":
      // A run is cancelled before another starts: one at a time.
      return state.kind === "running"
        ? state
        : { kind: "running", requestId: event.requestId, sent: event.text, changed: false };
    case "answer":
      if (state.kind !== "running" || state.requestId !== event.requestId) return state;
      return {
        kind: "preview",
        original: state.sent,
        proposal: event.text,
        editing: false,
        stale: state.changed,
        notices: event.notices,
      };
    case "fail":
      if (state.kind !== "running" || state.requestId !== event.requestId) return state;
      return {
        kind: "failed",
        reason: event.reason,
        ...(event.params ? { params: event.params } : {}),
      };
    case "field":
      if (state.kind === "running") return { ...state, changed: event.text !== state.sent };
      if (state.kind === "preview") return { ...state, stale: event.text !== state.original };
      if (state.kind === "undo" && event.text !== state.after) return { kind: "idle" };
      return state;
    case "cancel":
      return state.kind === "running" ? { kind: "idle" } : state;
    case "edit":
      return state.kind === "preview" ? { ...state, editing: true } : state;
    case "proposal":
      return state.kind === "preview" && state.editing ? { ...state, proposal: event.text } : state;
    case "discard":
      return { kind: "idle" };
    case "accept":
      return state.kind === "preview"
        ? {
            kind: "undo",
            before: state.original,
            after: state.proposal,
            until: event.now + UNDO_WINDOW_MS,
          }
        : state;
    case "undo":
      return state.kind === "undo" ? { kind: "idle" } : state;
    case "tick":
      return state.kind === "undo" && event.now >= state.until ? { kind: "idle" } : state;
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
    return () => void this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.holder);
  }
}
