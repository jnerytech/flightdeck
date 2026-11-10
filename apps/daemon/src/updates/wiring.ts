import type { Config } from "../config.ts";
import { DAEMON_VERSION } from "../server.ts";
import { osServiceContext } from "../service-os.ts";
import { DaemonUpdater } from "./apply.ts";
import { AutoUpdater } from "./auto.ts";
import { UpdateChecker } from "./check.ts";

/**
 * The release checker, the daemon's updater and, with both, the auto updater (#280): a newer
 * version is applied by itself, only while nothing runs on the host. The checker is made first and
 * tells the auto updater after each check; it is checked in the background, so a slow or
 * unreachable release server never delays the boot.
 */
export function createUpdates(
  config: Config,
  host: { idle: () => boolean; log: (line: string) => void },
) {
  let autoUpdater: AutoUpdater | undefined;
  const updates = config.updates.manifestUrl
    ? new UpdateChecker({
        manifestUrl: config.updates.manifestUrl,
        checkIntervalH: config.updates.checkIntervalH,
        currentVersion: DAEMON_VERSION,
        onChecked: () => autoUpdater?.checked(),
      })
    : undefined;
  const updater = updates
    ? new DaemonUpdater({
        manifest: () => updates.latest(),
        dataDir: config.dataDir,
        ctx: osServiceContext(false),
      })
    : undefined;
  if (updates && updater) {
    autoUpdater = new AutoUpdater({
      enabled: () => config.updates.auto,
      currentVersion: DAEMON_VERSION,
      latest: updates.latest.bind(updates),
      idle: host.idle,
      apply: (proceed) => updater.apply(true, { proceed }),
      log: host.log,
    });
  }
  return { updates, updater, autoUpdater };
}
