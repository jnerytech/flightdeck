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
  return (
    <div
      role="tablist"
      aria-label={t("tabs.list")}
      className="flex h-9 items-end gap-0.5 border-b px-2"
    >
      {tabs.tabs.map((tab) => {
        const label = title(tab, state, store);
        const kind = tabKind(tab.router.current);
        const Icon = ICONS[kind];
        const active = tab.id === tabs.activeId;
        const badge = tabBadge(tab.router.current, state);
        return (
          <div
            key={tab.id}
            role="presentation"
            className={cn(
              "group flex max-w-48 items-center rounded-t-md border border-b-0 text-sm",
              active ? "bg-background" : "bg-muted/40 text-muted-foreground",
            )}
          >
            <button
              type="button"
              role="tab"
              aria-selected={active}
              {...(tab.pinned ? { "aria-label": label } : {})}
              className="flex min-w-0 items-center gap-1.5 px-2 py-1.5"
              onClick={() => tabs.activate(tab.id)}
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
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              aria-label={t("tabs.moveToOther", { title: label })}
              onClick={() => store.workspace.moveToOtherArea(tab.id)}
            >
              <ArrowLeftRight />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              aria-label={t(tab.pinned ? "tabs.unpin" : "tabs.pin", { title: label })}
              onClick={() => tabs.pin(tab.id, !tab.pinned)}
            >
              {tab.pinned ? <PinOff /> : <Pin />}
            </Button>
            {!tab.pinned && (
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                aria-label={t("tabs.close", { title: label })}
                onClick={() => store.closeTab(tabs, tab.id)}
              >
                <X />
              </Button>
            )}
          </div>
        );
      })}
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
