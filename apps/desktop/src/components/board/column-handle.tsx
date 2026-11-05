import { type KeyboardEvent, useEffect, useRef } from "react";
import type { T } from "../../i18n/index.ts";
import { COLUMN_WIDTH } from "../../lib/board-select.ts";

/**
 * The edge of a column that resizes them all: drag it, or focus it and use the arrows (20 px a
 * step), Home and End. It announces the width and its limits as a slider does. One width drives
 * every column, so the right edge of column `index` (1-based) moves `index` times the width's
 * change: the drag shares the distance among the columns to follow the pointer. Only the last
 * handle takes a tab stop (they are all the same control).
 */
export function ColumnHandle(props: {
  t: T;
  width: number;
  index: number;
  last: boolean;
  /** The width while a drag or a key moves it. */
  onChange(width: number): void;
  /** The drag is over: keep the width. */
  onCommit(): void;
}) {
  const { t, width } = props;
  const start = useRef<{ x: number; width: number } | null>(null);
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const move = (e: MouseEvent) => {
      const from = start.current;
      if (from) latest.current.onChange(from.width + (e.clientX - from.x) / latest.current.index);
    };
    const stop = () => {
      if (!start.current) return;
      start.current = null;
      latest.current.onCommit();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent) => {
    const to =
      e.key === "ArrowRight"
        ? width + COLUMN_WIDTH.step
        : e.key === "ArrowLeft"
          ? width - COLUMN_WIDTH.step
          : e.key === "Home"
            ? COLUMN_WIDTH.min
            : e.key === "End"
              ? COLUMN_WIDTH.max
              : null;
    if (to === null) return;
    e.preventDefault();
    props.onChange(to);
    props.onCommit();
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
      tabIndex={props.last ? 0 : -1}
      className="group/handle absolute inset-y-0 -right-2 z-10 flex w-2 cursor-col-resize justify-center outline-none"
      onKeyDown={onKeyDown}
      onPointerDown={(e) => {
        start.current = { x: e.clientX, width };
      }}
    >
      <span className="h-full w-px bg-transparent group-hover/handle:bg-border group-focus-visible/handle:w-0.5 group-focus-visible/handle:bg-ring" />
    </div>
  );
}
