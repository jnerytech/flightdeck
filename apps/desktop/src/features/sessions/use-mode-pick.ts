import type { PermissionMode, SettableMode } from "@flightdeck/protocol";
import { useState } from "react";
import { composerModeMenu } from "./domain/composer-pickers.ts";
import type { SessionState } from "./domain/session-state.ts";
import type { SessionActions } from "./session-actions.ts";

/**
 * The permission mode a session view shows and changes: the session's own mode, a pick shown at
 * once until the host answers, and the bypass question that comes before the loosest mode.
 */
export function useModePick(opts: {
  session: Pick<SessionState, "permissionMode" | "mode">;
  /** Names the conversation, so a pick stays with its own session. */
  scrollKey: string | undefined;
  actions: Pick<SessionActions, "setMode">;
  bypassAllowed: boolean;
  opencode: boolean;
}) {
  const { session, scrollKey, actions } = opts;
  // The session's own mode, null until it says (#935): never a guess of Default.
  const start = session.permissionMode ?? null;
  // The mode it runs in now: the last one it reported, else the one it opened with.
  const current = session.mode ?? start;
  // A pick belongs to the session and the mode it was made over: another session, or a new mode
  // from this one, shows its own.
  const owner = `${scrollKey ?? ""}|${current ?? ""}`;
  const [picks, setPicks] = useState<Readonly<Record<string, PermissionMode>>>({});
  const mode = picks[owner] ?? current;
  /**
   * Shows the pick at once and asks the host; a refusal (said in the error bar) takes it back, so
   * the chip shows the session's own mode again (#935).
   */
  const pickMode = (next: SettableMode) => {
    const key = owner;
    setPicks((all) => ({ ...all, [key]: next }));
    void actions.setMode?.(next).then((taken) => {
      if (taken !== false) return;
      setPicks(({ [key]: _refused, ...rest }) => rest);
    });
  };
  const [bypassAsk, setBypassAsk] = useState(false);
  // OpenCode has no accept-edits mode: the menu lists the others and the numbers follow.
  const modeMenu = composerModeMenu({
    current: mode,
    start,
    bypassAllowed: opts.bypassAllowed,
    opencode: opts.opencode,
  });
  /** A mode from the menu or Shift+Tab: bypass asks first, any other changes at once. */
  const chooseMode = (next: SettableMode) => {
    if (next === "bypassPermissions") {
      setBypassAsk(true);
      return;
    }
    pickMode(next);
  };
  return {
    mode,
    modeMenu,
    chooseMode,
    bypassAsk,
    cancelBypass: () => setBypassAsk(false),
    confirmBypass: () => {
      setBypassAsk(false);
      pickMode("bypassPermissions");
    },
  };
}
