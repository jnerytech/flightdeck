import type { AppKernel } from "../../lib/kernel.ts";
import { type AppUpdateCore, AppUpdateSlice, type AppUpdateState } from "./store.ts";

/**
 * Builds the app's own update slice from the store's kernel (#1596): its state and the update
 * switches of the settings. The platform's updater and quit, the check interval and the app log
 * stay the store's, as deps.
 */
export function wireAppUpdates(
  kernel: AppKernel<{
    appUpdate: AppUpdateState;
    settings: ReturnType<AppUpdateCore["switches"]>;
  }>,
  deps: Pick<AppUpdateCore, "updater" | "intervalMs" | "log" | "quitNow">,
): AppUpdateSlice {
  return new AppUpdateSlice({
    updater: deps.updater,
    state: () => kernel.state().appUpdate,
    setState: (appUpdate) => kernel.update({ appUpdate }),
    switches: () => kernel.state().settings,
    intervalMs: deps.intervalMs,
    log: deps.log,
    quitNow: deps.quitNow,
    t: () => kernel.t(),
  });
}
