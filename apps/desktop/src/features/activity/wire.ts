import type { AppKernel } from "../../lib/kernel.ts";
import { type ActivityCore, ActivitySlice } from "./store.ts";

/** Builds the away summary's slice from the store's kernel (#1596): each host's `activity.since`. */
export function wireActivity(
  kernel: AppKernel<ReturnType<ActivityCore["state"]>>,
  deps: { since: () => string | null },
): ActivitySlice {
  return new ActivitySlice({
    state: () => kernel.state(),
    update: (patch) => kernel.update(patch),
    since: deps.since,
    request: (hostId, since) => kernel.hostRequest(hostId, "activity.since", { since }),
  });
}
