import { type ReactNode, useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/context";
import { canScrollRight } from "@/lib/scroll-edge";

/**
 * The frame of a table whose columns only mean something side by side (responsive spec, `wide`):
 * it scrolls sideways by itself instead of pushing the page, the keyboard can reach and scroll it,
 * and a screen reader hears that it scrolls. An edge shadow shows where there is more, and a fade
 * on the right edge (the `table-wide-more` class, set from the scroll state) says it goes on.
 */
export function WideTable(props: Readonly<{ name: string; children: ReactNode }>) {
  const t = useT();
  const frame = useRef<HTMLElement>(null);
  const [more, setMore] = useState(false);

  // After every render (the rows may have changed the width), on a scroll and on a resize.
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const measure = () => setMore(canScrollRight(el.scrollLeft, el.clientWidth, el.scrollWidth));
    measure();
    el.addEventListener("scroll", measure);
    window.addEventListener("resize", measure);
    return () => {
      el.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  });

  return (
    <div className="table-wide-frame">
      <section
        ref={frame}
        data-slot="table-wide"
        aria-label={t("common.scrollsSideways", { name: props.name })}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a sideways scroller the keyboard must reach (axe scrollable-region-focusable)
        tabIndex={0}
        className={more ? "table-wide table-wide-more" : "table-wide"}
      >
        {props.children}
      </section>
      <span data-slot="table-wide-fade" aria-hidden="true" />
    </div>
  );
}
