import { type ReactNode, useRef } from "react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";

/**
 * A panel beside a rail icon (issue #689): the icon is the `trigger` and toggles `open` itself, so
 * a press on it while the panel is open closes it instead of closing and reopening it. Escape or a
 * press elsewhere closes it too, and the focus goes back to the icon.
 */
export function RailFlyout(
  props: Readonly<{
    /** The panel's accessible name. */
    label: string;
    open: boolean;
    onOpenChange(open: boolean): void;
    trigger: ReactNode;
    children: ReactNode;
  }>,
) {
  const anchor = useRef<HTMLDivElement>(null);
  // The panel closed because the person went elsewhere: the focus stays where they went.
  const wentElsewhere = useRef(false);
  return (
    <Popover open={props.open} onOpenChange={props.onOpenChange}>
      <PopoverAnchor ref={anchor}>{props.trigger}</PopoverAnchor>
      <PopoverContent
        side="right"
        align="start"
        aria-label={props.label}
        className="rail-flyout p-2"
        // The icon's own press closes the panel; counting it as "outside" would reopen it.
        onInteractOutside={(event) => {
          if (anchor.current?.contains(event.target as Node)) return event.preventDefault();
          wentElsewhere.current = true;
        }}
        onOpenAutoFocus={() => {
          wentElsewhere.current = false;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (wentElsewhere.current) return;
          anchor.current?.querySelector("button")?.focus();
        }}
      >
        {props.children}
      </PopoverContent>
    </Popover>
  );
}
