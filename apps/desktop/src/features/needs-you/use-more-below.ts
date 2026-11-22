import { type RefObject, useLayoutEffect, useState } from "react";

/** A difference of this many pixels or less is rounding (fractional scaling), not content. */
const SLACK = 2;

/** What a scrollable box holds: whether it scrolls at all, and whether more is below what shows. */
interface Reach {
  scrollable: boolean;
  more: boolean;
}

const NONE: Reach = { scrollable: false, more: false };

/**
 * What the scrollable `box` holds: `scrollable` while its content is taller than its height, `more`
 * while the end has not been scrolled to. It follows the scroll, the box and its content growing, and
 * the window, so a cue built on `more` goes at the end and a tab stop built on `scrollable` stays there.
 */
export function useMoreBelow(box: RefObject<HTMLElement | null>): Reach {
  const [reach, setReach] = useState(NONE);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const scrollable = el.scrollHeight - el.clientHeight > SLACK;
      const more = el.scrollHeight - el.scrollTop - el.clientHeight > SLACK;
      setReach((last) =>
        last.scrollable === scrollable && last.more === more ? last : { scrollable, more },
      );
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    // The box keeps its capped size while its content grows or shrinks: watch the content too.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    for (const child of Array.from(el.children)) observer?.observe(child);
    return () => {
      el.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [box]);
  return reach;
}
