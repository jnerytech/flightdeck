import {
  type GoogleConfig,
  type GoogleSignIn,
  googleSignIn,
  type SignInResult,
} from "../../lib/google-oauth.ts";
import type { Platform } from "../../platform/types.ts";
import {
  type BackupSchedule,
  type Cadence,
  DEFAULT_KEEP,
  loadSchedule,
  type RunReport,
  runScheduledBackup,
  type ScheduleTarget,
  saveSchedule,
} from "./backup-schedule.ts";
import { DriveError, driveTarget } from "./drive-target.ts";

/** What the person has to be told about: the passphrase to type, a folder to choose, a write that failed. */
export type Attention = "passphrase" | "no-folder" | "failed" | "drive-auth";

/** How often the app looks at whether a backup is owed. */
const CHECK_INTERVAL_MS = 15 * 60_000;

/**
 * Issue #1264: the scheduled backups of this app run. It holds the passphrase in memory only: it is
 * asked once per app start, never saved, logged or put in a report. A run that is owed but cannot go
 * (no passphrase, no folder, a write that failed) is kept in `report` for the screen to show.
 */
export class BackupScheduler {
  version = 0;
  /** The folder the shell stores (what the backups really go to), or null when none is chosen. */
  folder: string | null = null;
  report: RunReport = { status: "idle" };
  private readonly current: BackupSchedule;
  private passphrase: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  /** What the app was already told this start (issue #1327): each kind is said once, not every check. */
  private readonly told = new Set<Attention>();
  private readonly listeners = new Set<() => void>();
  /** The Google sign-in; null while no client id is configured or the shell has no loopback. */
  private readonly google: GoogleSignIn | null;
  private readonly net: typeof fetch;

  constructor(
    private readonly platform: Platform,
    private readonly options: {
      workFactor?: number;
      now?: () => number;
      intervalMs?: number;
      /** Tells the app something needs the person's eyes (issue #1327); at most once per kind per start. */
      onAttention?: (kind: Attention) => void;
      /** Issue #1444: Google Drive as a target; `config` is null while no client id is configured. */
      google?: { config: GoogleConfig | null; fetch?: typeof fetch };
    } = {},
  ) {
    this.current = loadSchedule(platform.storage);
    // A wrapper: the browser's fetch refuses to run as a method of another object.
    this.net = options.google?.fetch ?? (((input, init) => fetch(input, init)) as typeof fetch);
    const config = options.google?.config;
    this.google =
      config && platform.oauthLoopback
        ? googleSignIn({
            config,
            fetch: this.net,
            vault: platform.vault,
            loopback: platform.oauthLoopback,
            openExternal: (url) => platform.openExternal(url),
            ...(options.now && { now: options.now }),
          })
        : null;
  }

  /** Whether Drive can be chosen: a client id is configured and the shell can listen on the loopback. */
  get driveAvailable(): boolean {
    return this.google !== null;
  }

  /** Whether a Google sign-in is held (its token is in the vault). */
  driveSignedIn = false;

  /** Chooses where the backups go. Drive is refused where it is not available. */
  setTarget(target: ScheduleTarget): void {
    this.current.target = target === "drive" && !this.driveAvailable ? "folder" : target;
    this.save();
  }

  /** Opens Google's consent page and waits for the redirect; the token goes to the vault. */
  async signInDrive(): Promise<SignInResult> {
    if (!this.google) return "cancelled";
    const result = await this.google.signIn();
    this.driveSignedIn = await this.google.signedIn();
    this.notify();
    await this.tick();
    return result;
  }

  /** The names of the backups on Drive. Rejects with a `DriveError` when it cannot be read. */
  async driveBackups(): Promise<string[]> {
    const drive = this.drive();
    if (!drive) throw new DriveError("auth");
    return drive.list();
  }

  /** The text of one backup on Drive. */
  async driveBackupText(name: string): Promise<string> {
    const drive = this.drive();
    if (!drive) throw new DriveError("auth");
    return drive.get(name);
  }

  async signOutDrive(): Promise<void> {
    if (!this.google) return;
    await this.google.signOut();
    this.driveSignedIn = false;
    this.notify();
  }

  /** False on the web build, where no folder can be written. */
  get supported(): boolean {
    return this.platform.backupFolder !== undefined;
  }

  get hasPassphrase(): boolean {
    return this.passphrase !== null;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  schedule(): BackupSchedule {
    return { ...this.current };
  }

  /** Reads the stored folder, runs what is owed, then looks again every few minutes. */
  async start(): Promise<void> {
    const folder = this.platform.backupFolder;
    if (!folder) return;
    this.driveSignedIn = (await this.google?.signedIn().catch(() => false)) ?? false;
    this.folder = await folder.current().catch(() => null);
    if (this.folder && this.current.folder === "") this.current.folder = this.folder;
    // The passphrase lives in memory only, so every start with the schedule on has to ask for it.
    if (this.current.cadence !== "off" && this.folder && !this.passphrase)
      this.attend("passphrase");
    this.notify();
    this.dispose();
    this.timer = setInterval(() => void this.tick(), this.options.intervalMs ?? CHECK_INTERVAL_MS);
    await this.tick();
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async setCadence(cadence: Cadence): Promise<void> {
    this.current.cadence = cadence;
    if (cadence === "off") {
      // Nothing is owed any more: the passphrase is not kept for a schedule that is not there.
      this.passphrase = null;
      this.report = { status: "idle" };
    }
    this.save();
    await this.tick();
  }

  setKeep(keep: number): void {
    this.current.keep = Number.isFinite(keep) ? Math.max(1, Math.floor(keep)) : DEFAULT_KEEP;
    this.save();
  }

  /** Opens the folder dialog; a cancelled dialog changes nothing. */
  async chooseFolder(): Promise<void> {
    const picked = await this.platform.backupFolder?.pick();
    if (!picked) return;
    this.folder = picked;
    this.current.folder = picked;
    this.save();
    await this.tick();
  }

  /** Keeps the passphrase for this run of the app only, and runs what is owed with it. */
  async setPassphrase(passphrase: string): Promise<void> {
    this.passphrase = passphrase === "" ? null : passphrase;
    this.notify();
    await this.tick();
  }

  /** One look at the schedule: runs the backup when it is owed. The last run is saved only when it worked. */
  async tick(): Promise<void> {
    if (!this.supported || this.running) return;
    this.running = true;
    try {
      const report = await runScheduledBackup({
        platform: this.platform,
        folder: this.platform.backupFolder,
        drive: this.drive(),
        // Without Drive in this build a saved Drive target falls back to the folder.
        schedule: this.google ? this.current : { ...this.current, target: "folder" },
        passphrase: this.passphrase,
        now: (this.options.now ?? Date.now)(),
        options:
          this.options.workFactor === undefined ? {} : { workFactor: this.options.workFactor },
      });
      if (this.google && this.current.target === "drive") {
        this.driveSignedIn = await this.google.signedIn().catch(() => false);
      }
      if (report.status === "done") {
        this.current.lastRunAt = report.at;
        this.save();
      }
      if (report.status !== "idle") this.report = report;
      if (report.status === "skipped")
        this.attend(report.reason === "no-passphrase" ? "passphrase" : report.reason);
    } finally {
      this.running = false;
      this.notify();
    }
  }

  private drive() {
    const google = this.google;
    if (!google) return null;
    return driveTarget({
      fetch: this.net,
      auth: google.auth,
    });
  }

  private attend(kind: Attention): void {
    if (this.told.has(kind)) return;
    this.told.add(kind);
    this.options.onAttention?.(kind);
  }

  private save(): void {
    saveSchedule(this.platform.storage, this.current);
    this.notify();
  }

  private notify(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }
}
