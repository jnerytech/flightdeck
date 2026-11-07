import { useEffect, useRef, useState } from "react";
import type { AppStore } from "../lib/app-store.ts";
import type { XtermDeps } from "../lib/xterm-screen.ts";
import { TerminalPage } from "./TerminalPage.tsx";

/** Where a session page's shell comes from: one opened in the session's folder, or an existing one. */
export type TerminalSource = { session: string } | { terminalId: string };

/**
 * Issue #107: the Terminal view of a session page. A managed session gets a shell the host opens in
 * the session's own folder (`terminal.openSession`: the app names the session, never a path); a
 * session started from a terminal shows that terminal. The shell is asked for once, and kept under
 * the page's key, so a page that comes back (or a view switch) finds it instead of opening another.
 */
export function SessionTerminal(
  props: Readonly<{
    store: AppStore;
    hostId: string;
    /** Which session tab this is: the shell it opened is kept under it. */
    viewKey: string;
    source: TerminalSource;
    /** The terminal was closed from here: the page goes back to the conversation. */
    onClosed(): void;
    deps?: XtermDeps;
  }>,
) {
  const { store, hostId, viewKey, source } = props;
  const [terminalId, setTerminalId] = useState<string | null>(
    "terminalId" in source ? source.terminalId : null,
  );
  const asking = useRef(false);
  const session = "session" in source ? source.session : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the shell is asked for once per page
  useEffect(() => {
    if (!session || terminalId || asking.current) return;
    asking.current = true;
    // False once the page is gone: a shell that opens after that is ended, not left running unseen.
    let alive = true;
    void (async () => {
      const kept = store.sessionViews.terminalOf(viewKey);
      const listed = await store
        .terminalHost(hostId)
        .list()
        .catch(() => null);
      // A host that cannot say which shells are live is not a reason for a second one.
      if (
        kept &&
        (listed === null || listed.some((t) => t.terminalId === kept && t.exitCode === null))
      ) {
        if (alive) setTerminalId(kept);
        return;
      }
      const opened = await store.hostCommand(
        hostId,
        "terminal.openSession",
        { session, cols: 80, rows: 24 },
        { retry: false },
      );
      if (!opened) {
        // The refusal reached the person as a message: back to where they were.
        asking.current = false;
        if (alive) props.onClosed();
        return;
      }
      if (!alive) {
        void store.hostCommand(hostId, "terminal.close", {
          terminalId: opened.terminalId,
          kill: true,
        });
        return;
      }
      store.sessionViews.setTerminal(viewKey, opened.terminalId);
      setTerminalId(opened.terminalId);
    })();
    return () => {
      alive = false;
    };
  }, []);
  if (!terminalId) return null;
  return (
    <TerminalPage
      store={store}
      hostId={hostId}
      terminalId={terminalId}
      {...(props.deps ? { deps: props.deps } : {})}
      onClosed={() => {
        if (session) store.sessionViews.setTerminal(viewKey, null);
        props.onClosed();
      }}
    />
  );
}
