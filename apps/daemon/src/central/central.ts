import type { Database } from "bun:sqlite";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HooksStatusResult } from "@flightdeck/protocol";
import { type SnapshotInput, snapshotForHook } from "../checkpoints/snapshots.ts";
import { type Config, generateToken, updateConfigFile } from "../config.ts";
import { FlightdeckError } from "../errors.ts";
import type { AutoApprover } from "../permissions/auto-approve.ts";
import type { RiskClassifier } from "../permissions/risk.ts";
import type { SessionManager } from "../sessions/session-manager.ts";
import { ExternalSessions } from "./external.ts";
import { ExternalPermissions } from "./external-permissions.ts";
import { type HookTarget, hooksStatus, installHooks, uninstallHooks } from "./hooks-install.ts";
import { ProjectKeys } from "./project-key.ts";
import { type Receptor, startReceptor } from "./receptor.ts";
import { SessionMetaStore } from "./session-meta.ts";
import { RECEPTOR_FILE } from "./wrapper.ts";

/** How often quiet external sessions are checked for `stale`. */
const SWEEP_MS = 60_000;

export interface CentralOptions {
  /** Phase 13: the risk of the terminal sessions' permission requests. */
  risk?: RiskClassifier;
  /** Phase 13: the projects' automatic approval, for the terminal sessions too. */
  autoApprove?: Pick<AutoApprover, "decide">;
  /** Phase 12: terminal sessions' turns become git snapshots. */
  snapshots?: { enqueue(input: SnapshotInput): void };
  db: Database;
  manager: SessionManager;
  hooks: Config["hooks"];
  dataDir: string;
  hostName: string;
  /** Where install saves `hooks.token` the first time. */
  configFile: string;
  /** This daemon's command line, which the SessionStart hook runs. */
  selfCommand: string[];
  /** `~/.claude/settings.json` of this host's user (a temporary one in tests). */
  settingsPath: () => string;
}

/**
 * The session hub of a host: external sessions, their permission requests and the hook
 * receptor. The receptor only listens once `hooks.token` exists (at boot, or when hooks are
 * installed through the protocol), so a daemon without hooks opens no extra port.
 */
/** Sends to the channel of a session opened with `flightdeckd claude`; `false` without one. */
export function messageExternal(
  central: Pick<Central, "external" | "receptor">,
  claudeSessionId: string,
  text: string,
): boolean {
  const launchId = central.external.get(claudeSessionId)?.launchId;
  return launchId ? (central.receptor?.sendToLaunch(launchId, text) ?? false) : false;
}

export class Central {
  readonly external: ExternalSessions;
  readonly permissions: ExternalPermissions;
  readonly meta: SessionMetaStore;
  private readonly keys: ProjectKeys;
  private server: Receptor | null = null;
  private token: string | undefined;

  constructor(private readonly opts: CentralOptions) {
    this.permissions = new ExternalPermissions({ risk: opts.risk, auto: opts.autoApprove });
    this.keys = new ProjectKeys(opts.hostName);
    this.meta = new SessionMetaStore(opts.db);
    this.external = new ExternalSessions({
      db: opts.db,
      staleAfterS: opts.hooks.staleAfterS,
      projectKey: (cwd) => this.projectKey(cwd),
    });
    this.external.start(SWEEP_MS);
    this.token = opts.hooks.token;
    if (this.token) this.listen();
  }

  /** Delivers `external.message` to channels; absent while the receptor is not listening. */
  get receptor(): Receptor | undefined {
    return this.server ?? undefined;
  }

  /** Writes to the channel of a terminal launch; false when the receptor is down or there is none. */
  sendToLaunch(launchId: string, text: string): boolean {
    return this.server?.sendToLaunch(launchId, text) ?? false;
  }

  /** Group of the session in the app's list; see project-key.ts. */
  projectKey(cwd: string): string {
    return this.keys.keyFor(cwd);
  }

  receptorUrl(): string | null {
    return this.server?.url ?? null;
  }

  hooksStatus(): HooksStatusResult {
    const settingsPath = this.opts.settingsPath();
    return {
      status: hooksStatus(settingsPath, this.target()),
      settingsPath,
      receptorUrl: this.receptorUrl(),
    };
  }

  /** Generates the token once, starts the receptor and writes the hooks with its real port. */
  hooksInstall(confirm: boolean): HooksStatusResult {
    this.confirm(confirm);
    if (!this.token) {
      const token = generateToken();
      updateConfigFile(this.opts.configFile, (raw) => ({
        ...raw,
        hooks: { ...(raw.hooks as object), token },
      }));
      this.token = token;
    }
    if (!this.server) this.listen();
    installHooks(this.opts.settingsPath(), this.target());
    return this.hooksStatus();
  }

  hooksUninstall(confirm: boolean): HooksStatusResult {
    this.confirm(confirm);
    uninstallHooks(this.opts.settingsPath());
    return this.hooksStatus();
  }

  async stop(): Promise<void> {
    this.permissions.closeAll();
    this.external.stop();
    if (this.server) {
      await this.server.stop();
      rmSync(join(this.opts.dataDir, RECEPTOR_FILE), { force: true });
      this.server = null;
    }
  }

  private confirm(confirm: boolean): void {
    if (!confirm) {
      throw new FlightdeckError(
        "invalid_state",
        "mexer no ~/.claude/settings.json do host pede confirm: true",
      );
    }
  }

  private target(): HookTarget {
    return {
      command: this.opts.selfCommand,
      url: this.server?.url ?? `http://127.0.0.1:${this.opts.hooks.port}`,
      token: this.token ?? "",
      permissionTimeoutS: this.opts.hooks.permissionTimeoutS,
    };
  }

  /** Starts the receptor and publishes its URL for `flightdeckd claude`. */
  private listen(): void {
    const server = startReceptor({
      port: this.opts.hooks.port,
      token: () => this.token,
      external: this.external,
      permissions: this.permissions,
      isManaged: (id) => this.opts.manager.list().some((s) => s.claudeSessionId === id),
      onHook: (event, payload) => {
        const snapshot = snapshotForHook(event, payload);
        if (snapshot) this.opts.snapshots?.enqueue(snapshot);
      },
    });
    this.server = server;
    mkdirSync(this.opts.dataDir, { recursive: true });
    writeFileSync(join(this.opts.dataDir, RECEPTOR_FILE), JSON.stringify({ url: server.url }));
  }
}
