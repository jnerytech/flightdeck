import { type RefObject, useLayoutEffect, useState } from "react";

/** More than this many pixels under the visible part counts as more to read (sub-pixel rounding). */
const SLACK = 1;

/**
 * Whether the scrollable `box` holds more below what shows: true while its content is taller than its
 * height and the end has not been scrolled to. It follows the scroll, the box's own size and the
 * window's, so a cue built on it goes when the end is reached and when the content fits.
 */
export function useMoreBelow(box: RefObject<HTMLElement | null>, content: unknown): boolean {
  const [more, setMore] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `content` is when the height may have changed
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setMore(el.scrollHeight - el.scrollTop - el.clientHeight > SLACK);
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [box, content]);
  return more;
}
