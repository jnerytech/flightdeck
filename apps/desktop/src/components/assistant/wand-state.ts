/** The states of one wand and the one-run gate of the app (issue #158). */

export const UNDO_WINDOW_MS = 0;

export type WandState =
  | { kind: "idle" }
  | { kind: "running"; requestId: string; sent: string; changed: boolean }
  | {
      kind: "preview";
      original: string;
      proposal: string;
      editing: boolean;
      stale: boolean;
      notices: string[];
    }
  | { kind: "failed"; reason: string; params?: Record<string, string | number> }
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
  | { type: "field"; text: string }
  | { type: "cancel" }
  | { type: "edit" }
  | { type: "proposal"; text: string }
  | { type: "discard" }
  | { type: "accept"; now: number }
  | { type: "undo" }
  | { type: "tick"; now: number };

export function wandReduce(state: WandState, _event: WandEvent): WandState {
  return state;
}

export class RunGate {
  busy(): boolean {
    return true;
  }
  acquire(_id: string): boolean {
    return false;
  }
  release(_id: string): void {}
  subscribe(_listener: (holder: string | null) => void): () => void {
    return () => {};
  }
}
