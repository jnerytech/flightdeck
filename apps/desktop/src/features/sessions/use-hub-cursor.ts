import { useEffect, useState } from "react";
import { typing } from "../shortcuts/index.ts";
import type { HubRow } from "./domain/hub.ts";
import { cursorMove } from "./domain/hub-derive.ts";

/**
 * The row the keyboard is on: J and K move it down and up the listed rows, Enter opens the row
 * under it (a focused button keeps its own Enter). Returns the key of that row, if any, and `mark`, which puts the cursor on a row a click opened.
 */
export function useHubCursor(listed: readonly HubRow[], onOpen: (row: HubRow) => void) {
  /** The row the keyboard is on (-1: none yet). */
  const [cursor, setCursor] = useState(-1);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
      const moved = cursorMove(e.key, cursor, listed.length);
      if (moved !== null) setCursor(moved);
      else if (
        e.key === "Enter" &&
        listed[cursor] &&
        (e.target as HTMLElement).tagName !== "BUTTON"
      ) {
        onOpen(listed[cursor] as HubRow);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  return {
    activeKey: listed[cursor]?.key,
    mark: (row: HubRow) => setCursor(listed.findIndex((r) => r.key === row.key)),
  };
}
