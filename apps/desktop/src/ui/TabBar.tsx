import {
  ArrowLeftRight,
  BookOpen,
  Bot,
  Layers,
  type LucideIcon,
  MessageSquare,
  Pin,
  PinOff,
  Plus,
  SquareKanban,
  SquareTerminal,
  Wallet,
  X,
} from "lucide-react";
import { type ReactNode, useRef, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AppState, AppStore } from "../lib/app-store.ts";
import { breadcrumb } from "../lib/breadcrumb.ts";
import type { Route } from "../lib/router.ts";
import { type TabKind, tabBadge, tabKind } from "../lib/tab-badge.ts";
import type { Tab, Tabs } from "../lib/tabs.ts";

const ICONS: Record<TabKind, LucideIcon> = {
  session: MessageSquare,
  card: SquareKanban,
  terminal: SquareTerminal,
  reader: BookOpen,
  costs: Wallet,
  agent: Bot,
  screen: Layers,
};

/** The title of a tab: the last step of the path its route shows in the header. */
const title = (tab: Tab, state: AppState, store: AppStore) =>
  breadcrumb(tab.router.current, state, store.i18n.t).at(-1)?.label ?? "";

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
  const activeLabel = active ? title(active, state, store) : "";
  return (
    <div className="flex h-9 items-end gap-1 border-b px-2">
      {/* Only tabs in the tablist; the buttons act on the active tab and sit after it. */}
      <div role="tablist" aria-label={t("tabs.list")} className="flex min-w-0 items-end gap-0.5">
        {tabs.tabs.map((tab) => {
          const label = title(tab, state, store);
          const kind = tabKind(tab.router.current);
          const Icon = ICONS[kind];
          const selected = tab.id === tabs.activeId;
          const badge = tabBadge(tab.router.current, state);
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              {...(tab.pinned ? { "aria-label": label } : {})}
              className={cn(
                "flex min-w-0 max-w-48 items-center gap-1.5 rounded-t-md border border-b-0 px-2 py-1.5 text-sm",
                selected ? "bg-background" : "bg-muted/40 text-muted-foreground",
              )}
              onClick={() => tabs.activate(tab.id)}
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
              {!tab.pinned && <span className="truncate">{label}</span>}
              {badge && (
                <span
                  data-badge={badge}
                  className={cn(
                    "shrink-0 rounded-full px-1.5 text-xs",
                    badge === "needs-you"
                      ? "bg-status-needs-you text-white"
                      : "bg-muted text-muted-foreground",
                  )}
                  title={t(`tabs.badge.${badge}`)}
                >
                  {tab.pinned ? "" : t(`tabs.badge.${badge}`)}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {active && (
        <div className="mb-0.5 flex items-center">
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
          {!active.pinned && (
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              aria-label={t("tabs.close", { title: activeLabel })}
              onClick={() => store.closeTab(tabs, active.id)}
            >
              <X />
            </Button>
          )}
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
