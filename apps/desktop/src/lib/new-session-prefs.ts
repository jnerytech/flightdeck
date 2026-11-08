import type { PermissionMode } from "@flightdeck/protocol";
import type { Platform } from "../platform/types.ts";

/** Where the New session form's last choices are kept on this computer. */
export const NEW_SESSION_PREFS_KEY = "flightdeck.newSessionPrefs";

/** The folder last chosen on a host: one of its roots and the subfolder under it. */
export interface RememberedFolder {
  root: string;
  sub: string;
}

/** What the form starts from: the mode and model last used, and each host's last folder. */
export interface NewSessionPrefsValue {
  mode: PermissionMode;
  model: string;
  folders: Record<string, RememberedFolder>;
}

export class NewSessionPrefs {
  /** Replaced, never changed in place. */
  value: NewSessionPrefsValue = { mode: "plan", model: "stub", folders: {} };

  constructor(private readonly storage: Platform["storage"]) {}

  /** The folder last chosen on the host, if any. */
  folderOf(_hostId: string): RememberedFolder | undefined {
    return { root: "stub", sub: "" };
  }

  /** Keeps what a session was started with. */
  remember(
    _hostId: string,
    _choice: { root: string; sub: string; mode: PermissionMode; model: string },
  ): void {
    this.storage.getItem(NEW_SESSION_PREFS_KEY);
  }
}
