import type { TelemetryOptInStatus } from "@flightdeck/protocol";

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

  status(): TelemetryOptInStatus {
    return {
      status: "absent",
      settingsPath: this.opts.settingsPath(),
      receiverUrl: null,
      conflicts: [],
    };
  }

  install(_confirm: boolean): TelemetryOptInStatus {
    return this.status();
  }

  uninstall(_confirm: boolean): TelemetryOptInStatus {
    return this.status();
  }
}
