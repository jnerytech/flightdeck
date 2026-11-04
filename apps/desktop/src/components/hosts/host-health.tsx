import type { DepsResult, DoctorResult } from "@flightdeck/protocol";
import type { AppStore, HostView } from "../../lib/app-store.ts";

/**
 * One section for what a host needs and how it is doing: its dependencies (required and optional)
 * and the checks the doctor makes, with the same icon and word on every row.
 */
export function HostHealth(_props: {
  store: AppStore;
  host: HostView;
  deps: DepsResult | null;
  doctor: DoctorResult | null;
  /** When the health was read, in epoch milliseconds; null before the first read. */
  checkedAt: number | null;
  onCheck(): Promise<void>;
  /** "Add folder": the app takes the person to the allowed folders. */
  onAddFolder(): void;
}) {
  return null;
}
