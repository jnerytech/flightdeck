import type { DepsResult } from "@flightdeck/protocol";
import type { AppStore } from "../../lib/app-store.ts";

/** The host's dependencies, required and optional, each with what stops working without it. */
export function HostDeps(_props: {
  store: AppStore;
  deps: DepsResult | null;
  /** The host's operating system, as `host.info` says it. */
  os: string;
  onCheck(): Promise<void>;
}) {
  return null;
}
