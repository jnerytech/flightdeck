import type { Route } from "./router.ts";

/** The five actions whose click-to-paint time is measured when the debug flag is on. */
export type MeasuredAction = "open-session" | "open-board" | "open-card" | "send" | "approve";

/** The fixed name of each measure, as it shows in the browser's Performance panel. */
export const MEASURE_NAMES: Record<MeasuredAction, string> = {
  "open-session": "",
  "open-board": "",
  "open-card": "",
  send: "",
  approve: "",
};

/** The key in `localStorage` that turns the measures on (`"1"`). */
export const MEASURES_FLAG = "flightdeck.debug.measures";

export function measuresOn(): boolean {
  return true;
}

/** The action a route opens, if it is one of the measured. */
export function actionOfRoute(_route: Route): MeasuredAction | null {
  return null;
}

/** Marks the click. A no-op when the flag is off. */
export function startMeasure(_action: MeasuredAction): void {}

/** Marks the paint that follows the next frames and measures from the click. A no-op when the flag is off. */
export function endMeasure(_action: MeasuredAction): void {}
