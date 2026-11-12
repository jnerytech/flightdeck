import type { Config } from "../config.ts";
import { present } from "../present.ts";
import { type DomainModule, serverGroup } from "../server/index.ts";
import { osServiceContext } from "../service-os.ts";
import { DAEMON_VERSION } from "../version.ts";
import { DaemonUpdater } from "./apply.ts";
import { AutoUpdater, autoUpdateOf } from "./auto.ts";
import { UpdateChecker } from "./check.ts";

/**
 * The release checker, the daemon's updater and, with both, the auto updater (#280): a newer
 * version is applied by itself, only while nothing runs on the host. The checker is made first and
 * tells the auto updater after each check; it is checked in the background, so a slow or
 * unreachable release server never delays the boot.
 */
export function createUpdates(
  config: Config,
  host: { configFile: string; idle: () => boolean; log: (line: string) => void },
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
  const module: DomainModule<"updates"> = {
    server: {
      // A host without the update manifest runs none of them.
      updates: serverGroup<"updates", "check" | "apply" | "auto">()(
        present({
          check: updates,
          apply: updater,
          auto: autoUpdater && autoUpdateOf(autoUpdater, config, host.configFile),
        }),
      ),
    },
    // Not awaited: the boot does not wait on the release server (#2094).
    start: () => {
      void updates?.start();
    },
    stop: () => {
      updates?.stop();
      autoUpdater?.stop();
    },
  };
  return { modules: [module] as const };
}
