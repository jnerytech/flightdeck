import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";

const MIN = 280;
const MAX = 640;
const START = 380;
const STEP = 16;

const clamp = (width: number) => Math.min(MAX, Math.max(MIN, width));

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
}) {
  const [width, setWidth] = useState(START);
  /** Where a drag began: the pointer's x and the list's width then. */
  const drag = useRef<{ x: number; width: number } | null>(null);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (drag.current) setWidth(clamp(drag.current.width + e.clientX - drag.current.x));
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
    if (e.key === "ArrowLeft") setWidth((w) => clamp(w - STEP));
    else if (e.key === "ArrowRight") setWidth((w) => clamp(w + STEP));
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
      <div className="min-h-0 min-w-0 overflow-hidden">{props.list}</div>
      {/* biome-ignore lint/a11y/useSemanticElements: a focusable window splitter, which <hr> is not */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={props.labels.resize}
        aria-valuenow={width}
        aria-valuemin={MIN}
        aria-valuemax={MAX}
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
