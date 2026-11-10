import { useState } from "react";
import type { AppStore } from "../lib/app-store.ts";
import { liveElsewhere } from "../lib/live-elsewhere.ts";
import { LiveElsewhereDialog } from "./LiveElsewhereDialog.tsx";

/**
 * Issue #502, #1705: a second `claude` on a conversation that another one holds only after asking.
 * `guarded(go)` runs `go` at once when nobody holds it, else shows `dialog` (render it once) and
 * runs `go` only if the person chooses a second copy; "view" follows the live session instead.
 */
export function useLiveElsewhereGuard(
  store: AppStore,
  hostId: string,
  claudeSessionId: string | null,
) {
  // What waits while the person decides.
  const [pending, setPending] = useState<(() => unknown) | null>(null);
  const guarded = (go: () => unknown) => {
    // Read at the click, so it is never stale.
    if (
      claudeSessionId !== null &&
      liveElsewhere(store.getState().externals, hostId, claudeSessionId)
    )
      setPending(() => go);
    else return go();
  };
  const dialog =
    pending && claudeSessionId !== null ? (
      <LiveElsewhereDialog
        onView={() => {
          setPending(null);
          store.router.push({ name: "external", host: hostId, claudeSessionId });
        }}
        onAnyway={() => {
          setPending(null);
          void pending();
        }}
        onCancel={() => setPending(null)}
      />
    ) : null;
  /**
   * Whether another terminal holds the conversation (the transcript's age does not say). Read when the
   * caller renders: a caller that shows it must re-render with the store, as the reader does.
   */
  const held =
    claudeSessionId !== null &&
    liveElsewhere(store.getState().externals, hostId, claudeSessionId) !== null;
  return { guarded, dialog, held };
}
