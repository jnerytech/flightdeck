import type { TelemetryOptInStatus } from "@flightdeck/protocol";
import { generateToken, loadConfig, updateConfigFile } from "../config.ts";
import { FlightdeckError } from "../errors.ts";
import {
  installTelemetry,
  telemetryConflicts,
  telemetryStatus,
  uninstallTelemetry,
} from "./otlp-env.ts";

export interface TelemetryOptInOptions {
  configFile: string;
  /** `~/.claude/settings.json` of this host's user (a temporary one in tests). */
  settingsPath: () => string;
}

/**
 * The opt-in for a plain `claude`, shared by `flightdeckd telemetry` and the protocol: Flightdeck's
 * exporter keys in the user's settings.json, after a backup, never over a value of the user's.
 */
export class TelemetryOptIn {
  constructor(private readonly opts: TelemetryOptInOptions) {}

  /** The receiver's port: `telemetry.port`, else `hooks.port + 1`; 0 when neither is fixed. */
  private port(): number {
    const { telemetry, hooks } = loadConfig(this.opts.configFile);
    return telemetry.port ?? (hooks.port === 0 ? 0 : hooks.port + 1);
  }

  private setToken(token: string): void {
    updateConfigFile(this.opts.configFile, (raw) => ({
      ...raw,
      telemetry: { ...(raw.telemetry as object), token },
    }));
  }

  status(): TelemetryOptInStatus {
    const port = this.port();
    const file = this.opts.settingsPath();
    const url = port === 0 ? null : `http://127.0.0.1:${port}`;
    const token = loadConfig(this.opts.configFile).telemetry.token ?? "";
    return {
      status: telemetryStatus(file, { url: url ?? "", token }),
      settingsPath: file,
      receiverUrl: url,
      conflicts: telemetryConflicts(file),
    };
  }

  install(confirm: boolean): TelemetryOptInStatus {
    this.confirm(confirm);
    const file = this.opts.settingsPath();
    const port = this.port();
    if (port === 0) {
      throw new FlightdeckError(
        "invalid_state",
        "telemetry.port 0 does not work for an installed exporter: set a fixed telemetry.port (or hooks.port) in the config",
        "telemetry_port",
      );
    }
    const conflicts = telemetryConflicts(file);
    if (conflicts.length > 0) {
      throw new FlightdeckError(
        "invalid_state",
        `settings.json already sets ${conflicts.join(", ")}: those are yours, so nothing was changed. Remove them and run telemetry install again`,
        "telemetry_owned_keys",
        { keys: conflicts.join(", ") },
      );
    }
    if (!loadConfig(this.opts.configFile).telemetry.token) this.setToken(generateToken());
    const token = loadConfig(this.opts.configFile).telemetry.token ?? "";
    installTelemetry(file, { url: `http://127.0.0.1:${port}`, token });
    return this.status();
  }

  uninstall(confirm: boolean): TelemetryOptInStatus {
    this.confirm(confirm);
    uninstallTelemetry(this.opts.settingsPath());
    // The token that was written into settings.json stops working, wherever a copy is left.
    this.setToken(generateToken());
    return this.status();
  }

  private confirm(confirm: boolean): void {
    if (!confirm) {
      throw new FlightdeckError(
        "invalid_state",
        "changing ~/.claude/settings.json asks for confirm: true",
        "telemetry_confirm",
      );
    }
  }
}
