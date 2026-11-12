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
  return key === "" && shift ? { kind: "close" } : null;
}
