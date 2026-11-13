import type { Platform } from "../../platform/types.ts";

/** What the system's helpers read and ask through the app's store. */
export interface SystemCore {
  platform: Pick<
    Platform,
    "saveFile" | "copyText" | "pickFolder" | "logs" | "openPath" | "revealPath" | "vault"
  >;
  /** Whether the host is known and runs on this machine. */
  localHost(hostId: string): boolean;
  /** A failure for the person to read; `text` replaces the error's message. */
  fail(error: unknown, text?: string): void;
  /** A success toast. */
  success(text: string): void;
  /** The "copied" toast's text, in the app's language. */
  copiedText(): string;
}

/**
 * What the app asks of the machine it runs on (#1596: a slice of the store): the save and folder
 * dialogs, the clipboard, the shell's log file, and a host's files opened with the system's apps,
 * behind the guard that a file is local and named by a full path. Errors go to the person's toasts.
 */
export class SystemSlice {
  constructor(private readonly core: SystemCore) {}

  /** Saves a file through the system dialog; errors go to the banner. */
  async saveFile(name: string, text: string): Promise<boolean> {
    try {
      return await this.core.platform.saveFile(name, text);
    } catch (error) {
      this.core.fail(error, (error as Error).message);
      return false;
    }
  }

  /** Whether a backup file can be picked here: false in a browser, which has no file dialog (#1264). */
  canReadBackup(): boolean {
    return this.core.platform.vault.canPick !== false;
  }

  /** Whether this app can open the system's folder dialog (the desktop app, not a browser). */
  canPickFolder(): boolean {
    return this.core.platform.pickFolder !== undefined;
  }

  /** The folder the user picks in the system dialog; null when they cancel or there is none. */
  async pickFolder(): Promise<string | null> {
    try {
      return (await this.core.platform.pickFolder?.()) ?? null;
    } catch (error) {
      this.core.fail(error);
      return null;
    }
  }

  /** The shell's log file, when the app has one (not in a browser). */
  logs(): Platform["logs"] {
    return this.core.platform.logs;
  }

  /** Copies to the clipboard and answers with one toast: `done` when it says more than "copied". */
  async copyText(text: string, done?: string): Promise<boolean> {
    try {
      await this.core.platform.copyText(text);
      this.core.success(done ?? this.core.copiedText());
      return true;
    } catch (error) {
      this.core.fail(error);
      return false;
    }
  }

  /** Whether a file of the host can be opened here: the app can, and the host runs on this machine. */
  canOpenPaths(hostId: string): boolean {
    return this.core.platform.openPath !== undefined && this.core.localHost(hostId);
  }

  /** Opens a file the host made with the system's default app; false when it cannot. */
  async openPath(hostId: string, path: string): Promise<boolean> {
    return this.onLocalPath(hostId, path, (p) => this.core.platform.openPath?.(p));
  }

  /** Shows a file the host made in the system's file manager; false when it cannot. */
  async revealPath(hostId: string, path: string): Promise<boolean> {
    return this.onLocalPath(hostId, path, (p) => this.core.platform.revealPath?.(p));
  }

  private async onLocalPath(
    hostId: string,
    path: string,
    act: (path: string) => Promise<void> | undefined,
  ): Promise<boolean> {
    // Only a host of this machine has files that are here, and only a full path says which.
    if (
      !this.canOpenPaths(hostId) ||
      !/^([A-Za-z]:[\\/]|\/(?![\\/]))/.test(path) ||
      path.includes("..")
    ) {
      return false;
    }
    try {
      await act(path);
      return true;
    } catch (error) {
      this.core.fail(error);
      return false;
    }
  }
}
