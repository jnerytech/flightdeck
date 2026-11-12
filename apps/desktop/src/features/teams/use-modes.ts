import { useStoreSlice } from "@/lib/use-store";
import type { AppStore } from "../../lib/app-store.ts";
import { hasFeature } from "../../lib/version.ts";

/**
 * Issue #93: what a host takes for a team member's permission mode. A host that does not announce
 * it would ignore the choice, so the form shows none; Bypass needs the host's own switch.
 */
export function useModes(store: AppStore, hostId: string) {
  const { hosts } = useStoreSlice(store, MODES_KEYS);
  const host = hosts.find((h) => h.id === hostId);
  return {
    offered: hasFeature(host?.hostInfo?.features, "teams.permissions", false),
    efforts: hasFeature(host?.hostInfo?.features, "teams.effort", false),
    allowBypass: host?.hostInfo?.allowBypassPermissions === true,
    name: host?.name ?? hostId,
  };
}
const MODES_KEYS = ["hosts"] as const;

/** The model of each persona the host lists, by id: a member's effort depends on its model. */
export function usePersonaModels(store: AppStore, hostId: string): Record<string, string | null> {
  const listed = useStoreSlice(store, PERSONA_KEYS).personas[hostId];
  return Object.fromEntries((listed ?? []).map((p) => [p.id, p.model]));
}
const PERSONA_KEYS = ["personas"] as const;
