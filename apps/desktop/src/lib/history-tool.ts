import type { HistoryToolDetail } from "@flightdeck/protocol";
import type { AppStore } from "./app-store.ts";
import { hasFeature } from "./version.ts";

type Request = AppStore["hostRequest"];

/**
 * The loader of each stored tool row of a transcript (#606): on a host that answers `history.tool`,
 * a function that reads the call and its result; elsewhere none, and the row stays plain.
 */
export function toolLoader(
  request: Request,
  features: readonly string[] | undefined,
  hostId: string,
  claudeSessionId: string,
): (uuid: string, index: number) => (() => Promise<HistoryToolDetail | null>) | undefined {
  if (!hasFeature(features, "history.tool", false)) return () => undefined;
  return (uuid, index) => async () => {
    const result = await request(hostId, "history.tool", { claudeSessionId, uuid, index });
    return result.ok ? (result.data?.tool ?? null) : null;
  };
}
