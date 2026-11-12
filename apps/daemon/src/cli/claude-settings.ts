/**
 * The commands that write Claude Code's user settings (issue #1593): `flightdeckd hooks` (the
 * central's hooks) and `flightdeckd telemetry` (the OTLP exporters), each only by an explicit command.
 */

import {
  type HooksStatus,
  hooksStatus,
  hookTarget,
  installHooks,
  uninstallHooks,
} from "../central/index.ts";
import { claudeSettingsPath, generateToken, loadConfig, updateConfigFile } from "../config.ts";
import type { Logger } from "../kernel/index.ts";
import { daemonCommand } from "../service/index.ts";
import { TelemetryOptIn, type TelemetryStatus } from "../telemetry/index.ts";
import { type CliArgs, configPath } from "./args.ts";

/** What the settings commands need of the command line's deps (main.ts's `CliDeps`). */
export interface ClaudeSettingsCommandDeps {
  log: Logger;
  /** This daemon's own command line, as hooks call it back; derived from the process if absent. */
  selfCommand?: string[];
}

const HOOKS_LABELS: Record<HooksStatus, string> = {
  installed: "installed",
  absent: "absent",
  outdated: "outdated (run hooks install again)",
};

/**
 * `flightdeckd hooks install|uninstall|status`: the only write of Flightdeck in ~/.claude, always
 * by an explicit command. Install generates `hooks.token` once and keeps it afterwards.
 */
export async function runHooks(args: CliArgs, deps: ClaudeSettingsCommandDeps): Promise<void> {
  const file = configPath(args);
  let config = await loadConfig(file);
  const settings = claudeSettingsPath();
  const self = deps.selfCommand ?? daemonCommand(process.execPath, Bun.main);
  if (args.action === "status") {
    deps.log.log(`hooks: ${HOOKS_LABELS[await hooksStatus(settings, hookTarget(config, self))]}`);
    return;
  }
  if (args.action === "uninstall") {
    const removed = await uninstallHooks(settings);
    deps.log.log(removed ? `hooks removed from ${settings}` : "no Flightdeck hook installed");
    return;
  }
  if (config.hooks.port === 0) {
    throw new Error(
      "hooks.port 0 does not work for installed hooks: set a fixed port in the config",
    );
  }
  if (!config.hooks.token) {
    const token = generateToken();
    await updateConfigFile(file, (raw) => ({ ...raw, hooks: { ...(raw.hooks as object), token } }));
    config = await loadConfig(file);
  }
  await installHooks(settings, hookTarget(config, self));
  deps.log.log(`hooks installed in ${settings} (previous copy in settings.json.flightdeck-backup)`);
}

const TELEMETRY_LABELS: Record<TelemetryStatus, string> = {
  installed: "installed",
  absent: "absent",
  outdated: "outdated (run telemetry install again)",
  conflict: "not installed: settings.json has an exporter of your own",
};

/** `flightdeckd telemetry install|uninstall|status`: Claude Code's exporters into this daemon (phase 23). */
export async function runTelemetry(args: CliArgs, deps: ClaudeSettingsCommandDeps): Promise<void> {
  const optIn = new TelemetryOptIn({
    configFile: configPath(args),
    settingsPath: claudeSettingsPath,
  });
  if (args.action === "status") {
    deps.log.log(`telemetry: ${TELEMETRY_LABELS[(await optIn.status()).status]}`);
    return;
  }
  const had = (await optIn.status()).status;
  const result =
    args.action === "uninstall" ? await optIn.uninstall(true) : await optIn.install(true);
  const removed =
    had === "installed" || had === "outdated"
      ? `telemetry removed from ${result.settingsPath}`
      : "no Flightdeck telemetry installed";
  deps.log.log(
    args.action === "uninstall"
      ? `${removed}; the receiver has a new token`
      : `telemetry installed in ${result.settingsPath} (previous copy in settings.json.flightdeck-telemetry-backup)`,
  );
}
