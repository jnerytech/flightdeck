import type { TaskResultsResult } from "@flightdeck/protocol";
import type { T } from "../../i18n/index.ts";
import type { SessionState } from "../../lib/session-state.ts";

export interface TaskViewHandlers {
  onBack(): void;
  onStop(): void;
  onAnswer(requestId: string, decision: "allow" | "deny"): void;
  onOpenFull(): void;
  onCopy(text: string): void;
  onOpenFile(path: string): void;
  onRevealFile(path: string): void;
  /** The start of a text file; null when there is none to show. */
  onPreview(path: string): Promise<{ text: string; truncated: boolean } | null>;
  onAskChanges(text: string): void;
  onTryAgain(): void;
  onShowDetails(): void;
}

/** One task as simple mode shows it: header, what is happening, the question, the result. */
export function TaskView(
  _props: {
    title: string;
    session: SessionState;
    results: TaskResultsResult | null;
    t: T;
    /** The host is locked to simple: no way to full mode. */
    locked: boolean;
    /** The platform can open files of the host. */
    canOpen: boolean;
  } & TaskViewHandlers,
) {
  return null;
}
