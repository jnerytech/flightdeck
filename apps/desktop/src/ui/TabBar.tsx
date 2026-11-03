import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  BookOpen,
  Bot,
  type LucideIcon,
  MessageSquare,
  Pin,
  PinOff,
  Plus,
  SquareKanban,
  SquareTerminal,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { NAV_ICONS } from "@/components/nav-icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AppState, AppStore } from "../lib/app-store.ts";
import { breadcrumb } from "../lib/breadcrumb.ts";
import type { Route } from "../lib/router.ts";
import { isProd } from "../lib/ssh.ts";
import { type TabKind, tabBadge, tabKind } from "../lib/tab-badge.ts";
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

/** How a tab is moved from the keyboard. */
const MOVE_KEYS = "Control+Shift+ArrowLeft Control+Shift+ArrowRight";

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
  /** The tab a drag is over and the side the dragged one will land on, to mark the place. */
  const [dropOn, setDropOn] = useState<{ id: string; side: "before" | "after" } | null>(null);
  /** What a screen reader is told about the last move. */
  const [announcement, setAnnouncement] = useState("");
  /** The tab a keyboard move just went off with: the focus goes back to it. */
  const focusTab = useRef<string | null>(null);
  const active = tabs.tabs.find((tab) => tab.id === tabs.activeId);
  /** A move button just went off with the focus on it: the focus goes to the tab instead. */
  const refocusTab = useRef(false);
  const tablist = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusTab.current) {
      const id = focusTab.current;
      focusTab.current = null;
      tablist.current?.querySelector<HTMLElement>(`[role="tab"][data-tab-id="${id}"]`)?.focus();
    }
    if (!refocusTab.current) return;
    refocusTab.current = false;
    tablist.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
  });
  const shift = (id: string, delta: -1 | 1) => {
    tabs.shift(id, delta);
    refocusTab.current = !tabs.canShift(id, delta);
  };
  /** Moves a tab one place with the keyboard and says where it went. */
  const moveByKey = (tab: Tab, delta: -1 | 1) => {
    if (!tabs.canShift(tab.id, delta)) return;
    tabs.shift(tab.id, delta);
    focusTab.current = tab.id;
    setAnnouncement(
      t("tabs.moved", {
        title: title(tab, state, store),
        n: tabs.tabs.findIndex((other) => other.id === tab.id) + 1,
        total: tabs.tabs.length,
      }),
    );
  };
  const activeLabel = active ? title(active, state, store) : "";
  return (
    <div className="flex h-9 items-end gap-1 border-b px-2">
      {/* Only tabs (and the presentation wrappers that hold them) in the tablist; the move and pin buttons act on the active tab and sit after it. */}
      <div
        ref={tablist}
        role="tablist"
        aria-label={t("tabs.list")}
        className="flex min-w-0 items-end gap-0.5"
      >
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
              {...(dropOn?.id === tab.id ? { "data-drop": dropOn.side } : {})}
              className={cn(
                "group flex min-w-0 max-w-48 items-center rounded-t-md border border-b-0 text-sm",
                selected ? "bg-background" : "bg-muted/40 text-muted-foreground",
                prod && "border-2 border-destructive",
                dropOn?.id === tab.id &&
                  (dropOn.side === "before"
                    ? "border-l-2 border-l-primary"
                    : "border-r-2 border-r-primary"),
              )}
            >
              <button
                type="button"
                role="tab"
                aria-selected={selected}
                data-preview={tab.preview}
                {...(tab.preview ? { "aria-description": t("tabs.preview") } : {})}
                data-tab-id={tab.id}
                aria-keyshortcuts={`${tab.pinned ? "" : "Delete "}${MOVE_KEYS}`}
                {...(tab.pinned ? { "aria-label": label } : {})}
                className="flex min-w-0 flex-1 items-center gap-1.5 rounded-t-md px-2 py-1.5 outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => tabs.activate(tab.id)}
                onDoubleClick={() => tabs.commit(tab.id)}
                onKeyDown={(e) => {
                  if (e.key === "Delete") store.closeTab(tabs, tab.id);
                  else if (
                    e.ctrlKey &&
                    e.shiftKey &&
                    (e.key === "ArrowLeft" || e.key === "ArrowRight")
                  ) {
                    e.preventDefault();
                    e.stopPropagation();
                    moveByKey(tab, e.key === "ArrowLeft" ? -1 : 1);
                  }
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
                onDragOver={(e) => {
                  e.preventDefault();
                  const from = tabs.tabs.findIndex((other) => other.id === dragged.current);
                  if (from < 0 || tabs.tabs[from]?.id === tab.id) return setDropOn(null);
                  setDropOn({
                    id: tab.id,
                    side: from < tabs.tabs.indexOf(tab) ? "after" : "before",
                  });
                }}
                onDragEnd={() => {
                  dragged.current = null;
                  setDropOn(null);
                }}
                onDrop={() => {
                  const id = dragged.current;
                  dragged.current = null;
                  setDropOn(null);
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
                {badge && (
                  <span
                    data-badge={badge}
                    className={cn(
                      "shrink-0 rounded-full px-1.5 text-xs",
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
                    !selected && "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100",
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
      <div role="status" aria-label={t("tabs.position")} className="sr-only">
        {announcement}
      </div>
    </div>
  );
}
