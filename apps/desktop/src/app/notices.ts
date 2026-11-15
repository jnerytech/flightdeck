import { RequestError } from "../features/hosts/index.ts";
import type { AppState, Notice } from "../lib/app-state.ts";
import { sameNotice } from "./notice-lifetime.ts";

/** An error as one line: the host's code and message for a refusal, the text otherwise. */
export function describeError(error: unknown): string {
  return error instanceof RequestError ? `${error.code}: ${error.message}` : String(error);
}

interface NoticesDeps {
  state: () => AppState;
  update: (patch: Partial<AppState>) => void;
  /** The app log, which a refusal is written to. */
  log: (level: "error", source: string, message: string) => void;
}

/** The toasts and the error banner: what the app tells the person about a refusal or a success. */
export class Notices {
  private seq = 0;

  constructor(private readonly deps: NoticesDeps) {}

  /** The id of the next toast (the host link raises its own through the same counter). */
  nextId = (): number => ++this.seq;

  /** A short success toast (copied, saved, started…), already translated. */
  success(text: string, link?: { label: string; run: () => void }): void {
    this.deps.update({
      notices: [
        ...this.deps.state().notices,
        { id: this.nextId(), kind: "success", code: "", text, ...(link ? { link } : {}) },
      ],
    });
  }

  /** A toast closed (or shown, for successes): it leaves the list. */
  dismiss(id: number): void {
    this.deps.update({ notices: this.deps.state().notices.filter((n) => n.id !== id) });
  }

  /**
   * A host's error: a toast titled by its code, with the daemon's message as the detail. `text`
   * replaces the old one-line form kept in `error` (and the detail of a codeless one).
   */
  fail(error: unknown, text?: string, retry?: () => void, answersCommand = false): void {
    const code = error instanceof RequestError ? error.code : "";
    const message = error instanceof Error ? error.message : String(error);
    const prefix = code ? `${code}: ` : "";
    this.deps.log("error", "refusal", `${prefix}${text ?? message}`);
    const notice: Notice = { id: this.nextId(), kind: "error", code, text: text ?? message };
    if (error instanceof RequestError && error.reason) {
      notice.reason = error.reason;
      notice.params = error.params ?? {};
    }
    if (error instanceof RequestError && error.hostId) notice.hostId = error.hostId;
    if (retry) notice.retry = retry;
    if (answersCommand) notice.answersCommand = true;
    // The same error again takes the old one's place (#581): one toast, the newest, with a fresh timer.
    this.deps.update({
      error: text ?? describeError(error),
      notices: [...this.deps.state().notices.filter((n) => !sameNotice(n, notice)), notice],
    });
  }

  reportError(message: string): void {
    this.fail(new Error(message));
  }

  clearError(): void {
    this.deps.update({ error: null });
  }
}
