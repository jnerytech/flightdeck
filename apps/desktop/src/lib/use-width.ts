import { useEffect, useState } from "react";

/** The width of `ref`'s box, kept up to date; 0 until it is measured. */
export function useWidth(ref: { current: HTMLElement | null }): number {
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
