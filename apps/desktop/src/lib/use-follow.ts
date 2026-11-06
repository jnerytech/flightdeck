import { useLayoutEffect, useRef, useState } from "react";

/** How close to the end still counts as at the end, in pixels. */
const NEAR_END = 8;

/**
 * Keeps a scroll box at its end while new items arrive, the rule of the timeline (issue #315): a
 * scroll up by the person stops following, and a scroll back to the end or `jump` resumes it.
 * `count` is how many items there are; `missed` how many arrived while not following.
 */
export function useFollow(count: number) {
  const box = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const seen = useRef(count);
  const [missed, setMissed] = useState(0);

  useLayoutEffect(() => {
    const added = count - seen.current;
    seen.current = count;
    const el = box.current;
    if (!el || added <= 0) return;
    if (following.current) el.scrollTop = el.scrollHeight;
    else setMissed((n) => n + added);
  }, [count]);

  /** The scroll box's own scroll: at the end it follows again; anywhere else it stops. */
  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    following.current = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_END;
    if (following.current) setMissed(0);
  };

  const jump = () => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
    following.current = true;
    setMissed(0);
  };

  return { box, onScroll, missed, jump };
}
