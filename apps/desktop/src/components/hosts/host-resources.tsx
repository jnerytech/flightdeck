import type { AppStore, HostView } from "../../lib/app-store.ts";

/** What the host's work costs it: memory, disk, each session and terminal, and the orphans. (Stub.) */
export function HostResources(_props: {
  store: AppStore;
  host: HostView;
  /** The panel is on screen: it reads only then. */
  active?: boolean;
  /** Test seam: how often it reads, in ms. */
  everyMs?: number;
}) {
  return null;
}
