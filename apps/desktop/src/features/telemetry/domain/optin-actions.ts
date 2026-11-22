import type { TelemetryOptInStatus } from "@flightdeck/protocol";
import type { Key } from "../../../i18n/index.ts";

/** Why a button changes nothing: its reason, `"unknown"` while the status is not known, or `null` when it works. */
type Off = Key | "unknown" | null;

/**
 * Which of the install and remove buttons would change nothing, from the status of settings.json.
 * The daemon rewrites the same keys on an install over an installed exporter, refuses it over the
 * user's own, and removes only keys that are Flightdeck's: so install is a no-op when installed or in
 * conflict, remove when absent or in conflict. An out-of-date exporter keeps both.
 */
export function optinActions(status: TelemetryOptInStatus["status"] | null): {
  install: Off;
  uninstall: Off;
} {
  switch (status) {
    case null:
      return { install: "unknown", uninstall: "unknown" };
    case "installed":
      return { install: "telemetry.optinInstallOff.installed", uninstall: null };
    case "absent":
      return { install: null, uninstall: "telemetry.optinUninstallOff.absent" };
    case "conflict":
      return {
        install: "telemetry.optinInstallOff.conflict",
        uninstall: "telemetry.optinUninstallOff.conflict",
      };
    case "outdated":
      return { install: null, uninstall: null };
  }
}
