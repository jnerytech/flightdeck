import {
  type WheelEvent as ReactWheelEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { revealTab } from "./domain/reveal-tab.ts";

/** How far an arrow moves the strip. */
const STEP = 240;

/**
 * The scroll of the tab strip: which edges have more tabs than fit, the arrows' step, and the
 * active tab kept in view. The values that bring the active tab back (`triggers`) are the only
 * thing the strip needs from the tabs.
 */
export function useStripScroll(triggers: readonly unknown[]): {
  /** Goes on the element that scrolls: its ref and the handlers that tell a scroll by hand. */
  scrollerProps: {
    ref: RefObject<HTMLDivElement | null>;
    onScroll: () => void;
    onPointerDown: () => void;
    onWheel: (event: ReactWheelEvent) => void;
  };
  /** The element that holds the tabs: where a tab is looked for. */
  tablist: RefObject<HTMLDivElement | null>;
  /** The strip has more tabs than fit on either side. */
  more: { left: boolean; right: boolean };
  /** An arrow: one step to the left (-1) or to the right (1). */
  step(direction: -1 | 1): void;
} {
  const tablist = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  /** The strip has not been scrolled by hand since the active tab or the tab count last changed (#2728). */
  const settling = useRef(false);
  const [more, setMore] = useState({ left: false, right: false });
  const measure = useCallback(() => {
    const box = scroller.current;
    if (!box) return;
    const left = box.scrollLeft > 0;
    const right = box.scrollLeft + box.clientWidth < box.scrollWidth - 1;
    setMore((was) => (was.left === left && was.right === right ? was : { left, right }));
  }, []);
  const scrollBy = (delta: number) => {
    const box = scroller.current;
    settling.current = false;
    if (box) box.scrollLeft += delta;
    measure();
  };
  /** Scrolls the strip, by as little as it takes, until the active tab is in view. */
  const revealActive = useCallback(() => {
    const active = tablist.current?.querySelector<HTMLElement>(
      '[role="tab"][aria-selected="true"]',
    );
    if (active && scroller.current) revealTab(scroller.current, active);
  }, []);
  // The active tab is always in view (scrolled by hand, #1430); the strip is measured again when the
  // tabs change.
  useEffect(() => {
    settling.current = true;
    revealActive();
    measure();
  }, [...triggers, revealActive, measure]);
  // An arrow showing or going narrows or widens the strip: until the person scrolls it, the active
  // tab is brought back into view. A scroll by hand that crosses an edge is left where it is (#2728).
  // biome-ignore lint/correctness/useExhaustiveDependencies: the arrows are the triggers
  useEffect(() => {
    if (settling.current) revealActive();
  }, [more.left, more.right, revealActive]);
  return {
    scrollerProps: {
      ref: scroller,
      onScroll: measure,
      onPointerDown: () => {
        settling.current = false;
      },
      onWheel: (event) => {
        // A sideways swipe scrolls the strip by itself: it is a scroll by hand too.
        settling.current = false;
        if (event.deltaY !== 0) scrollBy(event.deltaY);
      },
    },
    tablist,
    more,
    step: (direction) => scrollBy(direction * STEP),
  };
}
