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
  /** What the field's text is written from or checked against (card title: its description). */
  context?: Record<string, string>;
  /** Opens Settings, section Assistant. */
  openSettings(): void;
}

/** Another provider a failed run can be sent to; a host carries the name the person gave it. */
export interface WandAlternative {
  provider: ResolvedProvider;
  hostName?: string;
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
  /** After a failure: the other providers that could run now and have the person's agreement. */
  others: WandAlternative[];
  /** After a failure: sends the text again, to this provider. */
  tryWith(provider: ResolvedProvider): void;
  /** Puts back the text from before Accept, while the Undo chip is up. */
  undo(): void;
  /** Ctrl or Cmd+I (and Esc while there is something to close) in the field: true when the wand took the key. */
  onKeyDown(event: React.KeyboardEvent): boolean;
}

/** The provider is a host, and not the field's own. */
function otherHost(provider: ResolvedProvider, fieldHostId: string | undefined): boolean {
  return (
    provider.provider === "host" && fieldHostId !== undefined && provider.hostId !== fieldHostId
  );
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
  const run = useRef<{ requestId: string; provider: ResolvedProvider; text: string } | null>(null);
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

  // The Undo chip lasts UNDO_WINDOW_MS after Accept: the reducer takes time from the event, so the timer sends it.
  const undoUntil = state.kind === "undo" ? state.until : null;
  useEffect(() => {
    if (undoUntil === null) return;
    const timer = setTimeout(
      () => dispatch({ type: "tick", now: Date.now() }),
      Math.max(0, undoUntil - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [undoUntil]);

  if (!binding || !controller || !enabled) return null;
  const spec = KIND_SPECS[binding.kind];
  const empty = value.trim() === "";
  const needsText = empty && !spec.generates;

  const launch = (text: string, chosen?: ResolvedProvider) => {
    const provider = chosen ?? controller.resolve(binding.fieldHostId);
    // A host the person never agreed to is asked in Settings, once; until then the text goes nowhere.
    if (!provider || controller.needsHostConfirm(provider)) {
      controller.askForSetup();
      binding.openSettings();
      return;
    }
    const requestId = crypto.randomUUID();
    run.current = { requestId, provider, text };
    dispatch({ type: "start", requestId, text });
    controller
      .run({
        requestId,
        kind: binding.kind,
        text,
        ...(binding.context ? { context: binding.context } : {}),
        ...(binding.fieldHostId ? { fieldHostId: binding.fieldHostId } : {}),
        // The folder is the field host's: another host never gets to see its path.
        ...(binding.cwd && !otherHost(provider, binding.fieldHostId) ? { cwd: binding.cwd } : {}),
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
  const start = () => {
    if (state.kind === "running" || state.kind === "preview" || needsText || gateBusy) return;
    launch(value);
  };
  /** The same text again, from the preview: the answer replaces the one shown. */
  const retry = () => {
    if (state.kind !== "preview" || gateBusy) return;
    launch(state.original);
  };
  const tryWith = (provider: ResolvedProvider) => {
    // The text of the failed run, not what the field holds by now.
    if (state.kind !== "failed" || !run.current || gateBusy) return;
    launch(run.current.text, provider);
  };
  const others =
    state.kind === "failed" && run.current
      ? controller
          .alternatives(run.current.provider)
          .filter((provider) => !controller.needsHostConfirm(provider))
          .map((provider) => ({
            provider,
            ...(provider.provider === "host"
              ? { hostName: controller.hostName(provider.hostId) }
              : {}),
          }))
      : [];
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
  const undo = () => {
    if (state.kind !== "undo") return;
    onChange(state.before);
    dispatch({ type: "undo" });
  };
  const onKeyDown = (event: React.KeyboardEvent): boolean => {
    if (event.key === "Escape" && state.kind !== "idle" && state.kind !== "undo") {
      if (state.kind === "running") cancel();
      else discard();
      return true;
    }
    const modified = (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey;
    if (!modified || event.nativeEvent.isComposing) return false;
    const key = event.key.toLowerCase();
    // Ctrl or Cmd+Z undoes the Accept while the field still holds it; the browser's own undo is not relied on.
    if (key === "z" && state.kind === "undo") {
      event.preventDefault();
      undo();
      return true;
    }
    if (key !== "i") return false;
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
    edit: () => dispatch({ type: "edit" }),
    setProposal: (text: string) => dispatch({ type: "proposal", text }),
    retry,
    others,
    tryWith,
    undo,
    onKeyDown,
  };
}
