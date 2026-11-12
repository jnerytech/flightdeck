import type { Route } from "./router.ts";

/** The five actions whose click-to-paint time is measured when the debug flag is on. */
export type MeasuredAction = "open-session" | "open-board" | "open-card" | "send" | "approve";

/** The fixed name of each measure, as it shows in the browser's Performance panel. */
export const MEASURE_NAMES: Record<MeasuredAction, string> = {
  "open-session": "fd:open-session",
  "open-board": "fd:open-board",
  "open-card": "fd:open-card",
  send: "fd:send",
  approve: "fd:approve",
};

/** The key in `localStorage` that turns the measures on (`"1"`). */
export const MEASURES_FLAG = "flightdeck.debug.measures";

const startMark = (action: MeasuredAction) => `${MEASURE_NAMES[action]}:start`;

export function measuresOn(): boolean {
  try {
    return localStorage.getItem(MEASURES_FLAG) === "1";
  } catch {
    return false;
  }
}

/** The action a route opens, if it is one of the measured. */
export function actionOfRoute(route: Route): MeasuredAction | null {
  if (route.name === "session") return "open-session";
  if (route.name === "board") return "open-board";
  if (route.name === "card") return "open-card";
  return null;
}

/** Marks the click. A no-op when the flag is off. */
export function startMeasure(action: MeasuredAction): void {
  if (measuresOn()) performance.mark(startMark(action));
}

/**
 * Measures from the click to the frame after the next paint (two animation frames). A no-op when
 * the flag is off or the action was not started.
 */
export function endMeasure(action: MeasuredAction): void {
  if (!measuresOn() || performance.getEntriesByName(startMark(action)).length === 0) return;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      performance.measure(MEASURE_NAMES[action], startMark(action));
      performance.clearMarks(startMark(action));
    }),
  );
}
