import { PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useBreakpoint } from "@/hooks/use-breakpoint";
import { cn } from "@/lib/utils";

/** Where the top bar lets the tab strip sit, once the shell has drawn it (null before, and in tests). */
const HeaderSlot = createContext<HTMLElement | null>(null);
export const useHeaderSlot = () => useContext(HeaderSlot);

export interface AppShellLabels {
  sidebar: string;
  collapse: string;
  expand: string;
}

/**
 * The app's frame: a fixed header over a two-column grid, the sidebar and the content (issue #641).
 * - Wide (1024 px and up): the 240 px sidebar pushes the content; the button folds it to the 56 px
 *   rail and back.
 * - Medium (640 to 1023 px): the rail stays, and the button opens the full sidebar over the content.
 * - Compact (below 640 px): no rail; the button opens the sidebar as a drawer.
 * The overlay and the drawer are one modal sheet: focus stays in it, Esc and a click outside close it,
 * and so does a new `navKey` (the person went somewhere).
 */
export function AppShell(
  props: Readonly<{
    header: ReactNode;
    /** The top bar's right side, after the tab strip (issue #282). */
    actions?: ReactNode;
    /** The slim bar under both columns (issue #491). */
    status?: ReactNode;
    sidebar: (collapsed: boolean) => ReactNode;
    labels: AppShellLabels;
    /** What the top bar gave up at a compact width, drawn above the sidebar in the drawer. */
    drawerTop?: ReactNode;
    /** The wide window's fold, kept by the caller; without it the shell keeps its own. */
    folded?: boolean;
    onFold?(folded: boolean): void;
    /** Changes when the person navigates: the overlay or the drawer closes. */
    navKey?: unknown;
    children: ReactNode;
  }>,
) {
  const breakpoint = useBreakpoint();
  const wide = breakpoint === "wide";
  const compact = breakpoint === "compact";
  /** The button's choice on a wide window: folded to the rail, or not (kept by the caller, if it gives it). */
  const [ownFold, setOwnFold] = useState(false);
  const folded = props.folded ?? ownFold;
  const setFolded = (value: boolean) => {
    setOwnFold(value);
    props.onFold?.(value);
  };
  /** The overlay (medium) or the drawer (compact) is open. */
  const [sheet, setSheet] = useState(false);
  const { labels, navKey } = props;
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const menu = useRef<HTMLButtonElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: closes on a new key and on a wider window
  useEffect(() => setSheet(false), [navKey, wide]);
  const open = wide && !folded;
  const expanded = wide ? open : sheet;
  const toggle = () => (wide ? setFolded(open) : setSheet((was) => !was));
  return (
    <div className="grid h-screen grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto] bg-background text-foreground">
      <header className="flex h-12 min-w-0 items-center gap-2 border-b px-3">
        <Button
          ref={menu}
          variant="ghost"
          size="icon"
          aria-label={wide && open ? labels.collapse : labels.expand}
          aria-expanded={expanded}
          {...(wide ? {} : { "aria-haspopup": "dialog" as const })}
          onClick={toggle}
        >
          {wide && open ? <PanelLeftClose /> : <PanelLeftOpen />}
        </Button>
        <div className="header-crumbs">{props.header}</div>
        <div ref={setSlot} className="header-tabs" />
        {props.actions}
      </header>
      <div
        className={cn(
          "grid min-h-0 transition-[grid-template-columns] duration-150 ease-out motion-reduce:transition-none",
          compact && "grid-cols-[minmax(0,1fr)]",
          !compact && (open ? "grid-cols-[240px_minmax(0,1fr)]" : "grid-cols-[56px_minmax(0,1fr)]"),
        )}
      >
        {/* The sidebar clips: its own body is the one area that scrolls (#567). */}
        {!compact && (
          <aside
            aria-label={labels.sidebar}
            data-slot="sidebar"
            data-collapsed={!open}
            className="min-h-0 overflow-hidden border-r bg-sidebar text-sidebar-foreground"
          >
            {props.sidebar(!open)}
          </aside>
        )}
        <main className="min-h-0 min-w-0 overflow-hidden">
          <HeaderSlot.Provider value={slot}>{props.children}</HeaderSlot.Provider>
        </main>
      </div>
      {props.status && (
        <div data-slot="shell-status" className="shell-status">
          {props.status}
        </div>
      )}
      {!wide && (
        <Sheet open={sheet} onOpenChange={setSheet}>
          <SheetContent
            side="left"
            showCloseButton={false}
            aria-describedby={undefined}
            onCloseAutoFocus={(event) => {
              // The button is outside the sheet, so Radix has no trigger to give the focus back to.
              event.preventDefault();
              menu.current?.focus();
            }}
            className="w-[min(320px,85vw)] gap-0 bg-sidebar text-sidebar-foreground data-[state=closed]:duration-150 data-[state=open]:duration-150 motion-reduce:animate-none motion-reduce:transition-none sm:max-w-none"
          >
            <SheetTitle className="sr-only">{labels.sidebar}</SheetTitle>
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-2 right-2 z-10"
              aria-label={labels.collapse}
              onClick={() => setSheet(false)}
            >
              <X />
            </Button>
            {props.drawerTop && <div className="drawer-top">{props.drawerTop}</div>}
            <div className="min-h-0 flex-1 overflow-hidden">{props.sidebar(false)}</div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
