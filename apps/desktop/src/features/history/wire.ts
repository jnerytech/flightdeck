import type { AppKernel } from "../../lib/kernel.ts";
import { type HistoryCore, HistorySlice } from "./store.ts";

/** Builds the history's slice from the store's kernel (#1596): a search goes to each host's `history.search`. */
export function wireHistory(
  kernel: AppKernel<ReturnType<HistoryCore["state"]>>,
  deps: Pick<HistoryCore, "listLimit" | "offline" | "reason"> & {
    searchTimeoutMs?: number;
    select(hostId: string, sessionId: string): void;
  },
): HistorySlice {
  return new HistorySlice({
    state: () => kernel.state(),
    update: (patch) => kernel.update(patch),
    request: (hostId, query) => kernel.connection(hostId)?.request("history.search", { query }),
    timeoutMs: () => deps.searchTimeoutMs ?? 5000,
    connection: (hostId) => kernel.connection(hostId),
    listLimit: deps.listLimit,
    offline: deps.offline,
    reason: deps.reason,
    fail: (error) => kernel.fail(error),
    select: (hostId, sessionId) => deps.select(hostId, sessionId),
  });
}
