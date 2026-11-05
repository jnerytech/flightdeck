import type { ReactNode } from "react";

/** A key, or a combination, as printed beside what it does: the one `<kbd>` of the app. */
export function Keycap(props: { children: ReactNode; className?: string }) {
  void props;
  return null;
}

/** A binding from the registry, written for this platform (`Ctrl` or `⌘`). */
export function ShortcutKeys(props: {
  keys: readonly string[];
  chord?: boolean;
  /** Whether the system is a Mac; read from the browser when absent. */
  mac?: boolean;
  className?: string;
}) {
  void props;
  return null;
}
