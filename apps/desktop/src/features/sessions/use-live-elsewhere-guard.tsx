import { useState } from "react";
import type { AppStore } from "../../lib/app-store.ts";
import { liveElsewhere } from "../../lib/live-elsewhere.ts";
import { LiveElsewhereDialog } from "./live-elsewhere-dialog.tsx";

/**
 * Issue #502, #1705: a second `claude` on a conversation that another one holds only after asking.
 * `ask(host, id, go)` runs `go` at once when nobody holds the conversation, else shows `dialog`
 * (render it once) and runs `go` only if the person chooses a second copy; "view" follows the live
 * session instead. For a caller whose conversation is not known until it acts (the palette).
 */
export function useLiveElsewhereAsk(store: AppStore) {
  // What waits while the person decides, and for which conversation.
  const [pending, setPending] = useState<{
    hostId: string;
    claudeSessionId: string;
    go: () => unknown;
  } | null>(null);
  const ask = (hostId: string, claudeSessionId: string | null, go: () => unknown) => {
    // Read at the click, so it is never stale.
    if (
      claudeSessionId !== null &&
      liveElsewhere(store.getState().externals, hostId, claudeSessionId)
    )
      setPending({ hostId, claudeSessionId, go });
    else return go();
  };
  const dialog = pending ? (
    <LiveElsewhereDialog
      onView={() => {
        setPending(null);
        store.router.push({
          name: "external",
          host: pending.hostId,
          claudeSessionId: pending.claudeSessionId,
        });
      }}
      onAnyway={() => {
        setPending(null);
        void pending.go();
      }}
      onCancel={() => setPending(null)}
    />
  ) : null;
  return { ask, dialog };
}

/** `useLiveElsewhereAsk` for one conversation known up front, and whether another terminal holds it. */
export function useLiveElsewhereGuard(
  store: AppStore,
  hostId: string,
  claudeSessionId: string | null,
) {
  const { ask, dialog } = useLiveElsewhereAsk(store);
  const guarded = (go: () => unknown) => ask(hostId, claudeSessionId, go);
  /**
   * Whether another terminal holds the conversation (the transcript's age does not say). Read when the
   * caller renders: a caller that shows it must re-render with the store, as the reader does.
   */
  const held =
    claudeSessionId !== null &&
    liveElsewhere(store.getState().externals, hostId, claudeSessionId) !== null;
  return { guarded, dialog, held };
}
