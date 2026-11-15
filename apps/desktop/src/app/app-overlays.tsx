import type { ReactNode } from "react";
import { WhatsNewDialog } from "@/features/appupdate/ui.ts";
import { ResumeOfferDialog } from "@/features/sessions/ui.ts";
import { Notices } from "@/features/shell/ui.ts";
import { SnippetUse } from "@/features/snippets/ui.ts";
import { isMac } from "../features/shortcuts/index.ts";
import { ShortcutsSheet } from "../features/shortcuts/ui.ts";
import { AskpassPrompt } from "../features/ssh/askpass-prompt.tsx";
import { TabSwitcherHost } from "../features/tabs/ui.ts";
import { TerminalCloseDialog } from "../features/terminal/ui.ts";
import type { AppState, AppStore } from "../lib/app-store.ts";

/**
 * What sits above the screens: notices, the resume offers, the tab switcher, the dialogs a store
 * flag opens, the `?` sheet, "what's new" and the Ctrl+K search. `App` keeps the flags and the
 * navigation; this only draws them.
 */
export function AppOverlays(
  props: Readonly<{
    store: AppStore;
    /** Only what the overlays read: the whole state stays with the screens that need it (#1589). */
    state: Pick<AppState, "hosts" | "resumeOffers" | "closingTerminal" | "snippetChoice">;
    /** The dialogs of the start and live-elsewhere questions, already built by their hooks. */
    askDialogs: ReactNode;
    help: boolean;
    whatsNew: boolean;
    onCloseHelp: () => void;
    onCloseWhatsNew: () => void;
    /** The Ctrl+K search, last in the stack: App draws it, it needs the whole state. */
    children?: ReactNode;
  }>,
) {
  const { store, state, askDialogs, help, whatsNew, onCloseHelp, onCloseWhatsNew } = props;
  return (
    <>
      <Notices store={store} />
      {Object.entries(state.resumeOffers).map(([hostId, offer]) => {
        const host = state.hosts.find((h) => h.id === hostId);
        return offer.open && host ? (
          <ResumeOfferDialog
            key={hostId}
            store={store}
            hostId={hostId}
            hostName={host.name}
            sessions={offer.sessions}
            resumed={offer.resumed}
          />
        ) : null;
      })}
      <TabSwitcherHost store={store} />
      {state.closingTerminal && (
        <TerminalCloseDialog onClose={(kill) => void store.terminals.finishClose(kill)} />
      )}
      <AskpassPrompt store={store} />
      {askDialogs}
      {state.snippetChoice && (
        <SnippetUse
          store={store}
          choice={state.snippetChoice}
          onClose={() => store.snippets.choose(null)}
        />
      )}
      {whatsNew && <WhatsNewDialog store={store} onClose={onCloseWhatsNew} />}
      {help && (
        <ShortcutsSheet
          store={store}
          mac={isMac(typeof navigator === "undefined" ? undefined : navigator)}
          onClose={onCloseHelp}
        />
      )}
      {props.children}
    </>
  );
}
