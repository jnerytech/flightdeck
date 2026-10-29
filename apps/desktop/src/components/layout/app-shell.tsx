import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { useMediaQuery } from "@/hooks/use-media-query";

/** Below this width the sidebar collapses by itself. */
export const NARROW_QUERY = "(max-width: 959px)";

export interface AppShellLabels {
  sidebar: string;
  collapse: string;
  expand: string;
}

/**
 * The app's frame: a fixed header over a two-column grid, the 260 px sidebar and the content.
 * The sidebar collapses by itself in narrow windows; the button overrides that until the window
 * crosses 960 px again.
 */
export function AppShell(props: {
  header: ReactNode;
  sidebar: ReactNode;
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
        className={
          open
            ? "grid min-h-0 grid-cols-[260px_minmax(0,1fr)]"
            : "grid min-h-0 grid-cols-[minmax(0,1fr)]"
        }
      >
        {open && (
          <aside
            aria-label={labels.sidebar}
            className="min-h-0 overflow-y-auto border-r bg-sidebar text-sidebar-foreground"
          >
            {props.sidebar}
          </aside>
        )}
        <main className="min-h-0 min-w-0 overflow-hidden">{props.children}</main>
      </div>
    </div>
  );
}
