import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";

/** Below this width the sidebar collapses by itself. */
export const NARROW_QUERY = "(max-width: 959px)";

export interface AppShellLabels {
  sidebar: string;
  collapse: string;
  expand: string;
}

/**
 * The app's frame: a fixed header over a two-column grid, the 240 px sidebar and the content. The
 * sidebar collapses to a 56 px rail of icons (it is given `collapsed` to draw itself); it does so
 * by itself in narrow windows, and the button overrides that until the window crosses 960 px again.
 */
export function AppShell(props: {
  header: ReactNode;
  sidebar: (collapsed: boolean) => ReactNode;
  labels: AppShellLabels;
  children: ReactNode;
}) {
  const narrow = useMediaQuery(NARROW_QUERY);
  /** The button's choice, valid while the window stays on the side of 960 px it was made on. */
  const [manual, setManual] = useState<{ open: boolean; narrow: boolean } | null>(null);
  const open = manual?.narrow === narrow ? manual.open : !narrow;
  const { labels } = props;
  return (
    <div className="grid h-screen grid-rows-[auto_minmax(0,1fr)] bg-background text-foreground">
      <header className="flex h-12 items-center gap-2 border-b px-3">
        <Button
          variant="ghost"
          size="icon"
          aria-label={open ? labels.collapse : labels.expand}
          aria-expanded={open}
          onClick={() => setManual({ open: !open, narrow })}
        >
          {open ? <PanelLeftClose /> : <PanelLeftOpen />}
        </Button>
        <div className="flex min-w-0 flex-1 items-center gap-2">{props.header}</div>
      </header>
      <div
        className={cn(
          "grid min-h-0 transition-[grid-template-columns] duration-150 ease-out",
          open ? "grid-cols-[240px_minmax(0,1fr)]" : "grid-cols-[56px_minmax(0,1fr)]",
        )}
      >
        <aside
          aria-label={labels.sidebar}
          data-collapsed={!open}
          className="min-h-0 overflow-y-auto overflow-x-hidden border-r bg-sidebar text-sidebar-foreground"
        >
          {props.sidebar(!open)}
        </aside>
        <main className="min-h-0 min-w-0 overflow-hidden">{props.children}</main>
      </div>
    </div>
  );
}
