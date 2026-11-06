import type { AssistantKind } from "@flightdeck/protocol";
import type * as React from "react";
import type { AssistantController } from "@/lib/assistant";
import type { WandState } from "./wand-state.ts";

/** What a field gives the wand: the assistant, the kind of text, whose host it is, and where "no provider" goes. */
export interface WandBinding {
  controller: AssistantController;
  kind: AssistantKind;
  fieldHostId?: string;
  cwd?: string;
  /** Opens Settings, section Assistant. */
  openSettings(): void;
}

export interface Wand {
  state: WandState;
  /** The field is empty and its kind cannot write from nothing. */
  needsText: boolean;
  /** The field is empty and its kind can write from nothing. */
  writes: boolean;
  /** Another wand holds the one run of the app. */
  otherRunning: boolean;
  start(): void;
  cancel(): void;
  accept(): void;
  discard(): void;
  /** Ctrl or Cmd+I in the field: true when the wand took the key. */
  onKeyDown(event: React.KeyboardEvent): boolean;
}

/** The wand of one field (issue #158), or null when there is none: no binding, or "Show the wand" off. */
export function useWand(
  _binding: WandBinding | undefined,
  _value: string,
  _onChange: (value: string) => void,
): Wand | null {
  return null;
}
