import type { AppStore, HostView } from "@/lib/app-store";

/**
 * Issue #1404: the host's switch for pausing new card runs before a restart or an update. Hidden on a
 * daemon that predates it.
 */
export function HostPausePanel(_props: Readonly<{ store: AppStore; host: HostView }>) {
  return null;
}
