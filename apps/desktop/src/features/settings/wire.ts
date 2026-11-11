import type { AppKernel } from "../../lib/kernel.ts";
import { type SettingsCore, SettingsSlice } from "./store.ts";

/**
 * Builds the settings' slice from the store's kernel (#1596): the person's choices on this machine.
 * The platform and what the global shortcut opens are the store's, as deps.
 */
export function wireSettings(
  kernel: AppKernel<ReturnType<SettingsCore["state"]>>,
  deps: { platform: SettingsCore["platform"]; onShortcut: SettingsCore["onShortcut"] },
): SettingsSlice {
  return new SettingsSlice({
    state: () => kernel.state(),
    update: (patch) => kernel.update(patch),
    platform: deps.platform,
    t: () => kernel.t(),
    onShortcut: deps.onShortcut,
  });
}
