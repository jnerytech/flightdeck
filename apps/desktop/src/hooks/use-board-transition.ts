import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

/** Whether the person asked the system for less motion. */
function reducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/**
 * What a board shows, with the move between two arrangements drawn by the browser's view
 * transition when it has one. `signature` names the arrangement (which card is in which column, in
 * what order): while it is the one on screen the data follows at once; when it changes the new
 * arrangement is applied inside `document.startViewTransition`, so the cards that changed place
 * glide there. Without the API, or with reduced motion, it is applied plainly.
 */
export function useBoardTransition<T>(next: T, signature: string): T {
  const [held, setHeld] = useState({ signature, data: next });
  const arranged = held.signature === signature;
  const latest = useRef(next);
  latest.current = next;
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new arrangement starts a move
  useEffect(() => {
    if (held.signature === signature) return;
    const apply = () => setHeld({ signature, data: latest.current });
    const start = document.startViewTransition;
    if (typeof start !== "function" || reducedMotion()) {
      apply();
      return;
    }
    start.call(document, () => {
      flushSync(apply);
    });
  }, [signature]);
  return arranged ? next : held.data;
}
