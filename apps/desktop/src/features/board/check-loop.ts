/**
 * Issue #1361: how a card's check loop goes, as a dictionary key and its params: nothing while the
 * switch is off; then ready, checking, the round of max, or how the last loop ended.
 */
import type { CheckLoopSwitch } from "@flightdeck/protocol";

export function checkLoopLine(
  loop: CheckLoopSwitch,
): { key: string; params: Record<string, string | number> } | null {
  if (!loop.on) return null;
  if (loop.active === "checking") return { key: "checkLoopUi.checking", params: {} };
  if (loop.active === "fixing") {
    return { key: "checkLoopUi.fixing", params: { round: loop.round ?? 0, max: loop.max ?? 0 } };
  }
  const last = loop.last;
  // A reason this app does not know reads as null: the switch is on, and that is what it says.
  if (last?.state === "ended" && last.reason) {
    return {
      key: `checkLoopUi.ended.${last.reason}`,
      params: { max: loop.max ?? 0, command: last.command ?? "" },
    };
  }
  return { key: "checkLoopUi.ready", params: {} };
}
