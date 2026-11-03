import type { AppState, AppStore } from "../../lib/app-store.ts";
import type { HubRow } from "../../lib/hub.ts";

/** Sessions of one project side by side: status, last lines, pending request, small composer. */
export function SessionTiles(_props: {
  store: AppStore;
  state: AppState;
  hostId: string;
  projectKey: string;
  onOpen(row: HubRow): void;
}) {
  return null;
}
