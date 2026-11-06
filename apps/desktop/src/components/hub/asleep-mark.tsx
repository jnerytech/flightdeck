import { Moon } from "lucide-react";

/** "Asleep" beside a session's name: the icon is decoration, the word says it. */
export function AsleepMark(props: { label: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-muted-foreground text-xs">
      <Moon aria-hidden="true" className="size-3" />
      {props.label}
    </span>
  );
}
