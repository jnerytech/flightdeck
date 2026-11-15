import { type ReactNode, useState } from "react";
import { ConfirmDialog } from "@/shared/feedback/index.ts";
import type { T } from "../../i18n/index.ts";
import { EndWithChangesDialog } from "./end-with-changes-dialog.tsx";
import type { SessionActions } from "./session-actions.ts";

/**
 * The End button of a session: it asks first, and when the checkout has files nobody committed
 * (#1133) it offers Commit… before ending. `press` is the button's click, `dialogs` what it opens.
 */
export function useEndSession(options: {
  actions: Pick<SessionActions, "close">;
  t: T;
  /** How many files the session's checkout has not committed; absent: End only confirms. */
  uncommitted?: () => Promise<number>;
  /** Shows the session's Changes, where those files are committed. */
  onCommitFirst?: () => void;
}): { ending: boolean; press: () => Promise<void>; dialogs: ReactNode } {
  const { actions, t, uncommitted, onCommitFirst } = options;
  const [closing, setClosing] = useState(false);
  // #1133: how many files End found uncommitted, while it asks about them.
  const [unsaved, setUnsaved] = useState<number | null>(null);
  /** The session is being ended: Encerrar is busy until the daemon says so. */
  const [ending, setEnding] = useState(false);
  const end = () => {
    setEnding(true);
    void actions.close().finally(() => setEnding(false));
  };
  const press = async () => {
    const count = uncommitted ? await uncommitted().catch(() => 0) : 0;
    if (count > 0) setUnsaved(count);
    else setClosing(true);
  };
  const dialogs = (
    <>
      {closing && (
        <ConfirmDialog
          message={t("session.endMessage")}
          confirmLabel={t("session.endConfirm")}
          destructive
          onConfirm={() => {
            setClosing(false);
            end();
          }}
          onCancel={() => setClosing(false)}
        />
      )}
      {unsaved !== null && (
        <EndWithChangesDialog
          t={t}
          files={unsaved}
          onCommit={() => {
            setUnsaved(null);
            onCommitFirst?.();
          }}
          onEnd={() => {
            setUnsaved(null);
            end();
          }}
          onCancel={() => setUnsaved(null)}
        />
      )}
    </>
  );
  return { ending, press, dialogs };
}
