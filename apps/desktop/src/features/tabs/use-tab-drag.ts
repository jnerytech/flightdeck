import { type DragEvent, useRef, useState } from "react";
import type { Tab, Tabs } from "./tabs.ts";

/** The tab a drag is over and the side the dragged one will land on, to mark the place. */
type DropOn = { id: string; side: "before" | "after" };

/**
 * Dragging a tab to a new place in its own set: which tab is dragged, and where it would land.
 * `dragProps` goes on the button of one tab, with the set that tab belongs to.
 */
export function useTabDrag(): {
  dropOn: DropOn | null;
  dragProps(
    tab: Tab,
    own: Tabs,
  ): {
    draggable: true;
    onDragStart(): void;
    onDragOver(event: DragEvent): void;
    onDragEnd(): void;
    onDrop(): void;
  };
} {
  /** The tab being dragged to a new place. */
  const dragged = useRef<string | null>(null);
  const [dropOn, setDropOn] = useState<DropOn | null>(null);
  return {
    dropOn,
    dragProps: (tab, own) => ({
      draggable: true,
      onDragStart: () => {
        dragged.current = tab.id;
      },
      onDragOver: (event) => {
        event.preventDefault();
        const from = own.tabs.findIndex((other) => other.id === dragged.current);
        if (from < 0 || own.tabs[from]?.id === tab.id) return setDropOn(null);
        setDropOn({
          id: tab.id,
          side: from < own.tabs.indexOf(tab) ? "after" : "before",
        });
      },
      onDragEnd: () => {
        dragged.current = null;
        setDropOn(null);
      },
      onDrop: () => {
        const id = dragged.current;
        dragged.current = null;
        setDropOn(null);
        if (id && own.tabs.some((other) => other.id === id)) own.move(id, own.tabs.indexOf(tab));
      },
    }),
  };
}
