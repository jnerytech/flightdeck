import { ArrowLeft } from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { clampListWidth, LIST_DEFAULT, LIST_MAX, LIST_MIN } from "@/lib/list-width";

const STEP = 16;
/** Below this width of the area there is room for one pane only. */
const NARROW = 560;
/** The most of the area the list may take, so the detail keeps room to breathe. */
const LIST_SHARE = 0.45;

/** The width of `ref`'s box, kept up to date; 0 until it is measured. */
function useWidth(ref: { current: HTMLElement | null }): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const box = ref.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      setWidth(Math.round(entries[0]?.contentRect.width ?? 0));
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/**
 * A list on the left (about 380 px, resized by the divider with the pointer or ← →) and the
 * detail of the chosen item on the right; without one, `empty` says what to do. Esc closes the
 * detail. It lays out against the width of its own area, not of the window: the list never takes
 * more than 45% of it, and a narrow area shows one pane at a time (the detail brings a button
 * back to the list).
 */
export function SplitView(props: {
  list: ReactNode;
  detail: ReactNode | null;
  empty: ReactNode;
  onClose(): void;
  labels: { resize: string; back: string };
  /** The width the list starts with (default 380) and what to do when it changes. */
  initialWidth?: number;
  onResize?(width: number): void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const area = useWidth(box);
  const narrow = area > 0 && area < NARROW;
  const [width, setWidth] = useState(props.initialWidth ?? LIST_DEFAULT);
  /** The width as last set, so keys pressed before a render still add up. */
  const current = useRef(width);
  const onResize = useRef(props.onResize);
  onResize.current = props.onResize;
  const resize = useCallback((next: number) => {
    current.current = next;
    setWidth(next);
    onResize.current?.(next);
  }, []);
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
  }, [resize]);

  const onDividerKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "ArrowLeft") resize(clampListWidth(current.current - STEP));
    else if (e.key === "ArrowRight") resize(clampListWidth(current.current + STEP));
  };

  const listWidth = area > 0 ? Math.min(width, Math.floor(area * LIST_SHARE)) : width;
  const detail = props.detail ?? props.empty;
  const group = (children: ReactNode, columns: string) => (
    // biome-ignore lint/a11y/useSemanticElements: a layout group, not a fieldset
    <div
      ref={box}
      role="group"
      className="grid h-full min-h-0"
      style={{ gridTemplateColumns: columns }}
      onKeyDown={(e) => {
        if (e.key === "Escape") props.onClose();
      }}
    >
      {children}
    </div>
  );
  if (narrow && props.detail) {
    return group(
      <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
        <div className="border-b p-1">
          <Button type="button" variant="ghost" size="sm" onClick={props.onClose}>
            <ArrowLeft />
            {props.labels.back}
          </Button>
        </div>
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{props.detail}</div>
      </div>,
      "minmax(0, 1fr)",
    );
  }
  if (narrow) {
    return group(
      <div className="@container min-h-0 min-w-0 overflow-hidden">{props.list}</div>,
      "minmax(0, 1fr)",
    );
  }
  return group(
    <>
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
      <div className="min-h-0 min-w-0 overflow-hidden">{detail}</div>
    </>,
    `${listWidth}px 1px minmax(0, 1fr)`,
  );
}
