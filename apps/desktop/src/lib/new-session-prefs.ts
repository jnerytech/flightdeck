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

/** The modes worth keeping: bypass asks again each time, so it is never the starting point. */
const KEPT_MODES: readonly PermissionMode[] = ["default", "acceptEdits", "plan", "auto", "dontAsk"];

const NOTHING: NewSessionPrefsValue = { mode: "default", model: "", folders: {} };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isKept = (mode: unknown): mode is PermissionMode =>
  KEPT_MODES.includes(mode as PermissionMode);

/** What is kept, read leniently: a part that is missing or of the wrong kind starts from nothing. */
function read(storage: Platform["storage"]): NewSessionPrefsValue {
  try {
    const kept: unknown = JSON.parse(storage.getItem(NEW_SESSION_PREFS_KEY) ?? "{}");
    if (!isRecord(kept)) return NOTHING;
    const folders: Record<string, RememberedFolder> = {};
    if (isRecord(kept.folders)) {
      for (const [host, folder] of Object.entries(kept.folders)) {
        if (isRecord(folder) && typeof folder.root === "string" && typeof folder.sub === "string") {
          folders[host] = { root: folder.root, sub: folder.sub };
        }
      }
    }
    return {
      mode: isKept(kept.mode) ? kept.mode : NOTHING.mode,
      model: typeof kept.model === "string" ? kept.model : NOTHING.model,
      folders,
    };
  } catch {
    return NOTHING;
  }
}

export class NewSessionPrefs {
  /** Replaced, never changed in place. */
  value: NewSessionPrefsValue;

  constructor(private readonly storage: Platform["storage"]) {
    this.value = read(storage);
  }

  /** The folder last chosen on the host, if any. */
  folderOf(hostId: string): RememberedFolder | undefined {
    return this.value.folders[hostId];
  }

  /** Keeps what a session was started with; a mode that is not worth keeping leaves the last one. */
  remember(
    hostId: string,
    choice: { root: string; sub: string; mode: PermissionMode; model: string },
  ): void {
    this.value = {
      mode: isKept(choice.mode) ? choice.mode : this.value.mode,
      model: choice.model,
      folders: { ...this.value.folders, [hostId]: { root: choice.root, sub: choice.sub } },
    };
    try {
      this.storage.setItem(NEW_SESSION_PREFS_KEY, JSON.stringify(this.value));
    } catch {
      // The form works without a memory.
    }
  }
}
