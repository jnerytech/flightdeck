import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { isMac, keysText } from "../../lib/shortcuts.ts";

/** A key, or a combination, as printed beside what it does: the one `<kbd>` of the app. */
export function Keycap(props: { children: ReactNode; className?: string }) {
  return (
    <kbd className={cn("keycap shrink-0 bg-muted font-mono", props.className)}>
      {props.children}
    </kbd>
  );
}

/** A binding from the registry, written for this platform (`Ctrl` or `⌘`). */
export function ShortcutKeys(props: {
  keys: readonly string[];
  chord?: boolean;
  /** Whether the system is a Mac; read from the browser when absent. */
  mac?: boolean;
  className?: string;
}) {
  const mac = props.mac ?? isMac(typeof navigator === "undefined" ? undefined : navigator);
  return (
    <Keycap {...(props.className ? { className: props.className } : {})}>
      {keysText(props.keys, props.chord === true, mac)}
    </Keycap>
  );
}
