import { type KeyboardEvent, useEffect, useRef } from "react";
import type { T } from "../../i18n/index.ts";
import { COLUMN_WIDTH } from "../../lib/board-select.ts";

/**
 * The edge of a column that resizes them all: drag it, or focus it and use the arrows (20 px a
 * step). It announces the width and its limits as a slider does.
 */
export function ColumnHandle(props: { t: T; width: number; onChange(width: number): void }) {
  const { t, width } = props;
  const start = useRef<{ x: number; width: number } | null>(null);
  const latest = useRef(props.onChange);
  latest.current = props.onChange;

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (start.current) latest.current(start.current.width + (e.clientX - start.current.x));
    };
    const stop = () => {
      start.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    props.onChange(width + (e.key === "ArrowRight" ? 1 : -1) * COLUMN_WIDTH.step);
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: a window splitter that moves has no native element (WAI-ARIA)
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t("board.resize")}
      aria-valuemin={COLUMN_WIDTH.min}
      aria-valuemax={COLUMN_WIDTH.max}
      aria-valuenow={width}
      aria-valuetext={t("board.resizeValue", { n: width })}
      tabIndex={0}
      className="group/handle absolute inset-y-0 -right-2 z-10 flex w-2 cursor-col-resize justify-center outline-none"
      onKeyDown={onKeyDown}
      onPointerDown={(e) => {
        start.current = { x: e.clientX, width };
      }}
    >
      <span className="h-full w-px bg-transparent group-hover/handle:bg-border group-focus-visible/handle:bg-ring" />
    </div>
  );
}
