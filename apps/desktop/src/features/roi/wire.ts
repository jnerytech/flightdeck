import type { AppKernel } from "../../lib/kernel.ts";
import { type RoiCore, RoiSlice } from "./store.ts";

/**
 * Builds the ROI figures' slice from the store's kernel (#1596): each host's `roi.summary`. Which
 * client a project belongs to and the ROI settings stay the store's, as deps.
 */
export function wireRoi(
  kernel: AppKernel<{ hosts: ReturnType<RoiCore["hosts"]> }>,
  deps: Pick<RoiCore, "clientOf" | "settings">,
): RoiSlice {
  return new RoiSlice({
    hosts: () => kernel.state().hosts,
    now: () => kernel.now(),
    summary: (hostId, range) => kernel.hostRequest(hostId, "roi.summary", range),
    clientOf: deps.clientOf,
    settings: deps.settings,
  });
}
