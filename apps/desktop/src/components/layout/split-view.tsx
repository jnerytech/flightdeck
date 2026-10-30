import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { clampListWidth, LIST_DEFAULT, LIST_MAX, LIST_MIN } from "@/lib/list-width";

const STEP = 16;

/**
 * A list on the left (about 380 px, resized by the divider with the pointer or ← →) and the
 * detail of the chosen item on the right; without one, `empty` says what to do. Esc closes the
 * detail.
 */
export function SplitView(props: {
  list: ReactNode;
  detail: ReactNode | null;
  empty: ReactNode;
  onClose(): void;
  labels: { resize: string };
  /** The width the list starts with (default 380) and what to do when it changes. */
  initialWidth?: number;
  onResize?(width: number): void;
}) {
  const [width, setWidth] = useState(props.initialWidth ?? LIST_DEFAULT);
  /** The width as last set, so keys pressed before a render still add up. */
  const current = useRef(width);
  const resize = (next: number) => {
    current.current = next;
    setWidth(next);
    props.onResize?.(next);
  };
  /** Where a drag began: the pointer's x and the list's width then. */
  const drag = useRef<{ x: number; width: number } | null>(null);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (drag.current) resize(clampListWidth(drag.current.width + e.clientX - drag.current.x));
    };
    const stop = () => {
      drag.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
  }, []);

  const onDividerKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "ArrowLeft") resize(clampListWidth(current.current - STEP));
    else if (e.key === "ArrowRight") resize(clampListWidth(current.current + STEP));
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: a layout group, not a fieldset
    <div
      role="group"
      className="grid h-full min-h-0"
      style={{ gridTemplateColumns: `${width}px 1px minmax(0, 1fr)` }}
      onKeyDown={(e) => {
        if (e.key === "Escape") props.onClose();
      }}
    >
      <div className="@container min-h-0 min-w-0 overflow-hidden">{props.list}</div>
      {/* biome-ignore lint/a11y/useSemanticElements: a focusable window splitter, which <hr> is not */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={props.labels.resize}
        aria-valuenow={width}
        aria-valuemin={LIST_MIN}
        aria-valuemax={LIST_MAX}
        tabIndex={0}
        onKeyDown={onDividerKey}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, width };
        }}
        className="cursor-col-resize bg-border transition-colors duration-150 hover:bg-brand/50 focus-visible:bg-brand focus-visible:outline-none"
      />
      <div className="min-h-0 min-w-0 overflow-hidden">{props.detail ?? props.empty}</div>
    </div>
  );
}
