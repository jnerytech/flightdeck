/**
 * The service's public entry (#1594): installing, updating and removing flightdeckd as an OS
 * service (systemd, Task Scheduler), the stable binary and the user's PATH. Another domain
 * imports from here, never a file inside.
 */

export { binaryVersion } from "./adapters/flightdeckd-process.ts";
export { addToUserPath, binDir, removeFromUserPath } from "./domain/user-path.ts";
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
} from "./install.ts";
export { lingerState } from "./linger.ts";
export { killProcess, osServiceContext, processPath } from "./os.ts";
export { createPrompt, installStableBinary, reconcileStableBinary, runSetup } from "./setup.ts";
export {
  compareVersions,
  refusedAddress,
  requestShutdown,
  runUpdate,
  type StopDeps,
  stableBinPath,
  stopServiceDaemon,
  waitHealthy,
} from "./update.ts";
