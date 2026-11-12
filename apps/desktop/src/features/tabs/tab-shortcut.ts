/** What a tab shortcut asks for. */
export type TabIntent =
  | { kind: "toggle-split" }
  | { kind: "reopen" }
  | { kind: "new" }
  | { kind: "close" }
  | { kind: "next-host" }
  | { kind: "previous-host" }
  | { kind: "goto-host"; n: number }
  | { kind: "move"; step: -1 | 1 };

/** What a key asks for among the tab shortcuts (`key` lower-cased when a letter); null for any other key. */
export function tabIntent(key: string, shift: boolean): TabIntent | null {
  if (key === "\\") return { kind: "toggle-split" };
  if (key === "t") return { kind: shift ? "reopen" : "new" };
  if (key === "w") return { kind: "close" };
  if (key === "Tab") return { kind: shift ? "previous-host" : "next-host" };
  if (/^[1-9]$/.test(key) && !shift) return { kind: "goto-host", n: Number(key) };
  if (shift && key === "PageUp") return { kind: "move", step: -1 };
  if (shift && key === "PageDown") return { kind: "move", step: 1 };
  return null;
}
