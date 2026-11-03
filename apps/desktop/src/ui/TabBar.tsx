import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  BookOpen,
  Bot,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  type LucideIcon,
  MessageSquare,
  Pin,
  PinOff,
  Plus,
  SquareKanban,
  SquareTerminal,
  X,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { NAV_ICONS } from "@/components/nav-icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { AppState, AppStore } from "../lib/app-store.ts";
import { breadcrumb } from "../lib/breadcrumb.ts";
import type { Route } from "../lib/router.ts";
import { isProd } from "../lib/ssh.ts";
import { badgePulses, type TabKind, tabBadge, tabKind } from "../lib/tab-badge.ts";
import type { Tab, Tabs } from "../lib/tabs.ts";

const ICONS: Record<TabKind, LucideIcon> = {
  session: MessageSquare,
  card: SquareKanban,
  terminal: SquareTerminal,
  reader: BookOpen,
  agent: Bot,
  screen: NAV_ICONS.sessions,
  ...NAV_ICONS,
};

/** Past this many tabs the badges shrink to dots and the strip offers a menu of all of them. */
const COMPACT_AT = 8;
/** How far an arrow moves the strip. */
const STEP = 240;

/** What a terminal tab says about the ssh destino it was opened from, if it was. */
const sshOf = (tab: Tab, store: AppStore) => {
  const route = tab.router.current;
  return route.name === "terminal"
    ? store.sshTerminals.get(`${route.host}/${route.terminalId}`)
    : undefined;
};

/** The title of a tab: the last step of the path its route shows in the header. */
const title = (tab: Tab, state: AppState, store: AppStore) => {
  const ssh = sshOf(tab, store);
  if (ssh) return store.i18n.t("terminalUi.sshBadge", { name: ssh.name });
  return breadcrumb(tab.router.current, state, store.i18n.t).at(-1)?.label ?? "";
};

/** The tabs of the window: icon and title, pin and close. The shortcuts live in `App`. */
export function TabBar(props: {
  store: AppStore;
  state: AppState;
  tabs: Tabs;
  /** The split's own buttons, at the end of the bar of the first area. */
  children?: ReactNode;
}) {
  const { store, state, tabs } = props;
  const { t } = store.i18n;
  useSyncExternalStore(tabs.subscribe, () => tabs.version);
  /** The tab being dragged to a new place. */
  const dragged = useRef<string | null>(null);
  const active = tabs.tabs.find((tab) => tab.id === tabs.activeId);
  /** A move button just went off with the focus on it: the focus goes to the tab instead. */
  const refocusTab = useRef(false);
  const tablist = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  /** The strip has more tabs than fit on either side. */
  const [more, setMore] = useState({ left: false, right: false });
  const measure = useCallback(() => {
    const box = scroller.current;
    if (!box) return;
    const left = box.scrollLeft > 0;
    const right = box.scrollLeft + box.clientWidth < box.scrollWidth - 1;
    setMore((was) => (was.left === left && was.right === right ? was : { left, right }));
  }, []);
  const scrollBy = (delta: number) => {
    const box = scroller.current;
    if (box) box.scrollLeft += delta;
    measure();
  };
  const compact = tabs.tabs.length > COMPACT_AT;
  // The active tab is always in view; the strip is measured again when the tabs change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the active tab and the count are the triggers
  useEffect(() => {
    tablist.current
      ?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    measure();
  }, [tabs.activeId, tabs.tabs.length, measure]);
  useEffect(() => {
    if (!refocusTab.current) return;
    refocusTab.current = false;
    tablist.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
  });
  // No tab, no strip: the area shows the start screen alone.
  if (tabs.tabs.length === 0) return null;
  const shift = (id: string, delta: -1 | 1) => {
    tabs.shift(id, delta);
    refocusTab.current = !tabs.canShift(id, delta);
  };
  const activeLabel = active ? title(active, state, store) : "";
  return (
    <div className="flex h-9 items-end gap-1 border-b px-2">
      {/* Only tabs (and the presentation wrappers that hold them) in the tablist; the move and pin buttons act on the active tab and sit after it. */}
      {more.left && (
        <Button
          variant="ghost"
          size="icon"
          className="tab-tool"
          aria-label={t("tabs.scrollLeft")}
          onClick={() => scrollBy(-STEP)}
        >
          <ChevronLeft />
        </Button>
      )}
      <div
        ref={scroller}
        className="tab-scroller"
        onScroll={measure}
        onWheel={(e) => {
          if (e.deltaY !== 0) scrollBy(e.deltaY);
        }}
      >
        <div ref={tablist} role="tablist" aria-label={t("tabs.list")} className="tab-strip">
          {tabs.tabs.map((tab) => {
            const label = title(tab, state, store);
            const kind = tabKind(tab.router.current);
            const Icon = ICONS[kind];
            const selected = tab.id === tabs.activeId;
            const badge = tabBadge(tab.router.current, state);
            const ssh = sshOf(tab, store);
            // A production server is easy to mistake for another: its tab gets a red border.
            const prod = ssh ? isProd(ssh.tags) : undefined;
            return (
              // The wrapper is invisible to the tablist: the tab and its × are siblings inside it.
              <div
                key={tab.id}
                role="presentation"
                {...(prod === undefined ? {} : { "data-prod": String(prod) })}
                className={cn(
                  "tab-item group flex items-center rounded-t-md border border-b-0 text-sm",
                  selected ? "bg-background" : "bg-muted/40 text-muted-foreground",
                  prod && "border-2 border-destructive",
                )}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  data-preview={tab.preview}
                  {...(tab.preview ? { "aria-description": t("tabs.preview") } : {})}
                  {...(tab.pinned ? { "aria-label": label } : { "aria-keyshortcuts": "Delete" })}
                  className="flex min-w-0 flex-1 items-center gap-1.5 rounded-t-md px-2 py-1.5 outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => tabs.activate(tab.id)}
                  onDoubleClick={() => tabs.commit(tab.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Delete") store.closeTab(tabs, tab.id);
                  }}
                  onAuxClick={(e) => {
                    // The middle button closes a tab (App opens items in a new tab with it).
                    if (e.button !== 1) return;
                    e.stopPropagation();
                    store.closeTab(tabs, tab.id);
                  }}
                  draggable
                  onDragStart={() => {
                    dragged.current = tab.id;
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    const id = dragged.current;
                    dragged.current = null;
                    if (id) tabs.move(id, tabs.tabs.indexOf(tab));
                  }}
                >
                  <Icon data-icon={kind} className="size-4 shrink-0" aria-hidden />
                  {!tab.pinned && (
                    <span className={cn("truncate", tab.preview && "italic")}>{label}</span>
                  )}
                  {!tab.pinned &&
                    ssh?.tags.map((tag) => (
                      <span key={tag} className="shrink-0 rounded bg-muted px-1 text-xs">
                        {tag}
                      </span>
                    ))}
                  {badge && compact && !selected && (
                    <span
                      role="img"
                      data-badge={badge}
                      data-compact="true"
                      aria-label={t(`tabs.badge.${badge}`)}
                      title={t(`tabs.badge.${badge}`)}
                      className={cn(
                        "size-2 shrink-0 rounded-full",
                        badge === "needs-you" ? "bg-status-needs-you" : "bg-muted-foreground",
                        badgePulses(badge) && "motion-safe:animate-pulse",
                      )}
                    />
                  )}
                  {badge && !(compact && !selected) && (
                    <span
                      data-badge={badge}
                      className={cn(
                        "shrink-0 rounded-full px-1.5 text-xs",
                        badgePulses(badge) && "motion-safe:animate-pulse",
                        badge === "needs-you"
                          ? "bg-status-needs-you text-background"
                          : "bg-muted text-muted-foreground",
                      )}
                      title={t(`tabs.badge.${badge}`)}
                    >
                      {tab.pinned ? "" : t(`tabs.badge.${badge}`)}
                    </span>
                  )}
                </button>
                {!tab.pinned && (
                  <button
                    type="button"
                    aria-hidden="true"
                    tabIndex={-1}
                    aria-label={t("tabs.close", { title: label })}
                    className={cn(
                      "mr-1 flex size-6 shrink-0 items-center justify-center rounded-md hover:bg-accent focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring",
                      !selected &&
                        "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100",
                    )}
                    onClick={() => store.closeTab(tabs, tab.id)}
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {more.right && (
        <Button
          variant="ghost"
          size="icon"
          className="tab-tool"
          aria-label={t("tabs.scrollRight")}
          onClick={() => scrollBy(STEP)}
        >
          <ChevronRight />
        </Button>
      )}
      {compact && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="tab-tool" aria-label={t("tabs.all")}>
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-96 overflow-y-auto">
            {tabs.tabs.map((tab) => (
              <DropdownMenuItem key={tab.id} onSelect={() => tabs.activate(tab.id)}>
                {title(tab, state, store)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {active && (
        <div className="mb-0.5 flex items-center">
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label={t("tabs.moveLeft", { title: activeLabel })}
            disabled={!tabs.canShift(active.id, -1)}
            onClick={() => shift(active.id, -1)}
          >
            <ArrowLeft />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label={t("tabs.moveRight", { title: activeLabel })}
            disabled={!tabs.canShift(active.id, 1)}
            onClick={() => shift(active.id, 1)}
          >
            <ArrowRight />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label={t("tabs.moveToOther", { title: activeLabel })}
            onClick={() => store.workspace.moveToOtherArea(active.id)}
          >
            <ArrowLeftRight />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label={t(active.pinned ? "tabs.unpin" : "tabs.pin", { title: activeLabel })}
            onClick={() => tabs.pin(active.id, !active.pinned)}
          >
            {active.pinned ? <PinOff /> : <Pin />}
          </Button>
        </div>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="mb-0.5 size-7"
        aria-label={t("tabs.newTab")}
        onClick={() => {
          tabs.open({ name: "home" });
          store.openSearch();
        }}
      >
        <Plus />
      </Button>
      {props.children}
    </div>
  );
}
