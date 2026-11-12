import { useSyncExternalStore } from "react";
import { knownProjectKeys } from "@/features/projects/index.ts";
import { projectLabels } from "../features/costs/index.ts";
import type { AppStore } from "../lib/app-store.ts";

/**
 * The labels of `keys` on any screen: told apart against every project the app knows (the hosts'
 * own lists and every key a screen has read), so a name on two hosts always carries its host
 * (issue #881). The screen redraws when a new key is seen.
 */
export function useProjectLabels(store: AppStore, keys: string[]): Map<string, string> {
  useSyncExternalStore(store.projectKeys.subscribe, () => store.projectKeys.version);
  return projectLabels(keys, [
    ...store.projectKeys.all(),
    ...knownProjectKeys(store.getState().projects),
  ]);
}
