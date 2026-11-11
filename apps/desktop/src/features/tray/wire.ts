import type { AppKernel } from "../../lib/kernel.ts";
import { type TrayCore, type TrayPlatform, TraySlice, type TrayState } from "./store.ts";

/**
 * Builds the tray's slice from the store's kernel (#1596): the state it reads and the translator.
 * The platform, the waiting requests, the window's host and mode, the answer, the open and the
 * timers stay named deps.
 */
export function wireTray(
  kernel: AppKernel<TrayState>,
  deps: Omit<TrayCore, "state" | "t"> & { platform: TrayPlatform },
): TraySlice {
  const { platform, ...core } = deps;
  return new TraySlice(platform, {
    state: () => kernel.state(),
    t: () => kernel.t(),
    ...core,
  });
}
