import type { ReactNode } from "react";
import { InFlightTimers } from "../src/hooks/use-in-flight.ts";

const instant = {
  now: () => 0,
  setTimeout: (fn: () => void) => {
    fn();
    return 0;
  },
  clearTimeout: () => {},
};

/** The wait is over the moment it starts: every stage of an in-flight control is on screen. */
export function InstantClock(props: { children: ReactNode }) {
  return <InFlightTimers.Provider value={instant}>{props.children}</InFlightTimers.Provider>;
}
