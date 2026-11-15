import { useEffect, useRef, useState } from "react";

/**
 * The rail beside the settings sections: the section it marks and the jump to one. The mark follows
 * the scroll, and a section named by `wanted` (a budget alert opens the screen on one) is scrolled
 * to and focused.
 */
export function useSettingsRail(shown: readonly { id: string }[], wanted: string | undefined) {
  const [current, setCurrent] = useState<string | null>(null);
  // A click's mark holds while the page scrolls to the section (a short last one never reaches the
  // observer's band); the next wheel, touch or key hands the mark back to the scroll.
  const pinned = useRef(false);
  const go = (id: string) => {
    pinned.current = true;
    setCurrent(id);
    const target = document.getElementById(`settings-${id}`);
    target?.scrollIntoView?.({ block: "start" });
    target?.focus({ preventScroll: true });
  };
  // The rail marks the section on screen: the upper one when several are. Without the observer
  // (tests, old webviews) the mark is the last one a click went to.
  const shownIds = shown.map((section) => section.id).join(",");
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const ids = shownIds ? shownIds.split(",") : [];
    const onScreen = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id.replace(/^settings-/, "");
          if (entry.isIntersecting) onScreen.add(id);
          else onScreen.delete(id);
        }
        const first = ids.find((id) => onScreen.has(id));
        if (first && !pinned.current) setCurrent(first);
      },
      { rootMargin: "0px 0px -60% 0px" },
    );
    for (const id of ids) {
      const el = document.getElementById(`settings-${id}`);
      if (el) observer.observe(el);
    }
    const release = () => {
      pinned.current = false;
    };
    const handBack = ["wheel", "touchstart", "keydown"] as const;
    for (const type of handBack) window.addEventListener(type, release, { passive: true });
    return () => {
      observer.disconnect();
      for (const type of handBack) window.removeEventListener(type, release);
    };
  }, [shownIds]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new request moves the view
  useEffect(() => {
    if (wanted) go(wanted);
  }, [wanted]);
  return { current, go };
}
