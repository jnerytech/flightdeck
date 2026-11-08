import type { AppStore } from "@/lib/app-store";

/** Issue #1039: a decision record drafted from a session's summary (stub). */
export function AdrDraftDialog(
  _props: Readonly<{
    store: AppStore;
    hostId: string;
    /** The project folder whose library the record goes into. */
    path: string;
    /** The session summary the draft starts from. */
    summary: string;
    onClose(): void;
  }>,
) {
  return (
    <div>
      <input aria-label="Decision title" readOnly value="" />
      <textarea aria-label="Decision record text" readOnly value="" />
      <button type="button">Save as ADR</button>
    </div>
  );
}
