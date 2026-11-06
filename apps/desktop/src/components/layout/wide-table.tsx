import type { ReactNode } from "react";
import { useT } from "@/i18n/context";

/**
 * The frame of a table whose columns only mean something side by side (responsive spec, `wide`):
 * it scrolls sideways by itself instead of pushing the page, the keyboard can reach and scroll it,
 * and a screen reader hears that it scrolls. An edge shadow shows where there is more.
 */
export function WideTable(props: Readonly<{ name: string; children: ReactNode }>) {
  const t = useT();
  return (
    <section
      data-slot="table-wide"
      aria-label={t("common.scrollsSideways", { name: props.name })}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a sideways scroller the keyboard must reach (axe scrollable-region-focusable)
      tabIndex={0}
      className="table-wide"
    >
      {props.children}
    </section>
  );
}
