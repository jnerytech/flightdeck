import { type AssistantKind, KIND_SPECS } from "@flightdeck/protocol";
import type * as React from "react";
import { useCallback, useEffect, useReducer, useRef, useSyncExternalStore } from "react";
import type { AssistantController } from "@/lib/assistant";
import type { ResolvedProvider } from "@/lib/assistant-prefs";
import { failureOf } from "./refusal-text.ts";
import { type WandState, wandReduce } from "./wand-state.ts";

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
  /** Makes the proposal a text the person edits before Accept. */
  edit(): void;
  /** What the person typed into the edited proposal. */
  setProposal(text: string): void;
  /** Sends the same text again. */
  retry(): void;
  /** Ctrl or Cmd+I (and Esc while there is something to close) in the field: true when the wand took the key. */
  onKeyDown(event: React.KeyboardEvent): boolean;
}

const IDLE: WandState = { kind: "idle" };
const NOT_WATCHED = () => () => {};

/** The wand of one field (issue #158), or null when there is none: no binding, or "Show the wand" off. */
export function useWand(
  binding: WandBinding | undefined,
  value: string,
  onChange: (value: string) => void,
): Wand | null {
  const controller = binding?.controller;
  const [state, dispatch] = useReducer(wandReduce, IDLE);
  const run = useRef<{ requestId: string; provider: ResolvedProvider } | null>(null);
  const enabled = useSyncExternalStore(
    controller?.subscribe ?? NOT_WATCHED,
    () => controller?.prefs().enabled ?? false,
  );
  const watchGate = useCallback(
    (listener: () => void) => controller?.gate.subscribe(listener) ?? NOT_WATCHED(),
    [controller],
  );
  const gateBusy = useSyncExternalStore(watchGate, () => controller?.gate.busy() ?? false);

  useEffect(() => {
    dispatch({ type: "field", text: value });
  }, [value]);

  if (!binding || !controller || !enabled) return null;
  const spec = KIND_SPECS[binding.kind];
  const empty = value.trim() === "";
  const needsText = empty && !spec.generates;

  const start = () => {
    if (state.kind === "running" || state.kind === "preview" || needsText || gateBusy) return;
    const provider = controller.resolve(binding.fieldHostId);
    if (!provider) {
      controller.askForSetup();
      binding.openSettings();
      return;
    }
    const requestId = crypto.randomUUID();
    run.current = { requestId, provider };
    dispatch({ type: "start", requestId, text: value });
    controller
      .run({
        requestId,
        kind: binding.kind,
        text: value,
        ...(binding.fieldHostId ? { fieldHostId: binding.fieldHostId } : {}),
        ...(binding.cwd ? { cwd: binding.cwd } : {}),
        provider,
      })
      .then(
        (result) =>
          dispatch({ type: "answer", requestId, text: result.text, notices: result.notices }),
        (failure) => {
          const { reason, params } = failureOf(failure);
          dispatch({ type: "fail", requestId, reason, ...(params ? { params } : {}) });
        },
      );
  };
  const cancel = () => {
    if (state.kind !== "running" || !run.current) return;
    controller.cancel(run.current.requestId, run.current.provider).catch(() => {});
    dispatch({ type: "cancel" });
  };
  const discard = () => dispatch({ type: "discard" });
  const accept = () => {
    if (state.kind !== "preview") return;
    onChange(state.proposal);
    dispatch({ type: "accept", now: Date.now() });
  };
  const onKeyDown = (event: React.KeyboardEvent): boolean => {
    if (event.key === "Escape" && state.kind !== "idle" && state.kind !== "undo") {
      if (state.kind === "running") cancel();
      else discard();
      return true;
    }
    const modified = (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey;
    if (!modified || event.key.toLowerCase() !== "i" || event.nativeEvent.isComposing) return false;
    event.preventDefault();
    start();
    return true;
  };

  return {
    state,
    needsText,
    writes: empty && spec.generates,
    otherRunning: gateBusy && state.kind !== "running",
    start,
    cancel,
    accept,
    discard,
    edit: () => {},
    setProposal: () => {},
    retry: () => {},
    onKeyDown,
  };
}
