/**
 * The service's public entry (#1594): installing, updating and removing flightdeckd as an OS
 * service (systemd, Task Scheduler), the stable binary and the user's PATH. Another domain
 * imports from here, never a file inside.
 */

export { binaryVersion } from "./adapters/flightdeckd-process.ts";
export {
  daemonCommand,
  installService,
  resolveServiceClaude,
  runChecked,
  type ServiceCommand,
  type ServiceContext,
  serviceCommand,
  serviceStatus,
  startService,
  uninstallService,
} from "./domain/install.ts";
export { lingerState } from "./domain/linger.ts";
export { addToUserPath, binDir, removeFromUserPath } from "./domain/user-path.ts";
export { compareVersions, stableBinPath } from "./domain/version.ts";
export { setupFdLauncher } from "./fd-launcher.ts";
export { killProcess, osServiceContext, processPath } from "./os.ts";
export { createPrompt, installStableBinary, reconcileStableBinary, runSetup } from "./setup.ts";
export {
  refusedAddress,
  requestShutdown,
  runUpdate,
  type StopDeps,
  stopServiceDaemon,
  waitHealthy,
} from "./update.ts";
