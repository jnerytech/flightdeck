import type { AppState, AppStore } from "../../lib/app-store.ts";

/** The bottom bar of the app: the plan quota at a glance, the hosts online and a refresh. */
export function StatusBar(_props: {
  store: AppStore;
  state: Pick<AppState, "hosts" | "quota">;
  onRefresh(): void;
}) {
  return null;
}
