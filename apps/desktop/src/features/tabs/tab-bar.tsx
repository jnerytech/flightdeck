import { ChevronDown, ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import { type CSSProperties, Fragment, type ReactNode, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { HostDot } from "@/features/hosts/ui.ts";
import { CacheTimer } from "@/features/sessions/ui.ts";
import { cn } from "@/lib/utils";
import { IconTip } from "@/shared/feedback/index.ts";
import { useBreakpoint } from "@/shared/hooks/index.ts";
import type { AppState, AppStore } from "../../lib/app-store.ts";
import { tabKind } from "./domain/tab-badge.ts";
import { TabBadgeGlyph } from "./tab-badge-glyph.tsx";
import { TAB_ICONS, tabFacts, tabTitle } from "./tab-facts.ts";
import { ActiveMenu } from "./tab-menu.tsx";
import { TabOverflow } from "./tab-overflow.tsx";
import type { Tab, Tabs } from "./tabs.ts";
import { useStripScroll } from "./use-strip-scroll.ts";
import { useTabAnnounce } from "./use-tab-announce.ts";
import { useTabDrag } from "./use-tab-drag.ts";

/** Past this many tabs the badges shrink to dots and the strip offers a menu of all of them. */
const COMPACT_AT = 8;
/** How a tab is moved from the keyboard. */
const MOVE_KEYS = "Control+Shift+ArrowLeft Control+Shift+ArrowRight";

/** The marks on a tab's wrapper: production, pinned, its host's color, the side a drag would drop on, and the classes. */
function tabItemMarks(
  tab: Tab,
  marks: {
    prod: boolean | undefined;
    hostColor: string | undefined;
    drop: "before" | "after" | null;
  },
) {
  const { prod, hostColor, drop } = marks;
  return {
    ...(prod === undefined ? {} : { "data-prod": String(prod) }),
    ...(tab.pinned ? { "data-pinned": "true" } : {}),
    ...(hostColor
      ? { "data-host": "true", style: { "--host-color": hostColor } as CSSProperties }
      : {}),
    ...(drop ? { "data-drop": drop } : {}),
    className: cn(
      "tab-item group relative text-sm has-[[role=tab]:focus-visible]:ring-2 has-[[role=tab]:focus-visible]:ring-ring",
      prod && "border-2 border-destructive",
      drop === "before" && "border-l-2 border-l-primary",
      drop === "after" && "border-r-2 border-r-primary",
    ),
  };
}

/** The tabs of the window: icon and title, pin and close. The shortcuts live in `App`. */
export function TabBar(
  props: Readonly<{
    store: AppStore;
    state: AppState;
    tabs: Tabs;
    /** The shared screens, pinned at the left of this bar's tabs (issue #644). */
    shared?: Tabs;
    /** The split's own buttons, at the end of the bar of the first area. */
    children?: ReactNode;
  }>,
) {
  const { store, state, tabs, shared } = props;
  const { t } = store.i18n;
  // Under 640 px the row is one button for the current tab instead of a strip to scroll (issue #644).
  const narrow = useBreakpoint() === "compact";
  useSyncExternalStore(tabs.subscribe, () => tabs.version);
  useSyncExternalStore(store.hostTabs.subscribe, () => store.hostTabs.version);
  // The "all hosts" scope lists every host's tabs, grouped by host, after the shared ones (#644).
  const scope = useSyncExternalStore(store.tabScope.subscribe, () => store.tabScope.value);
  const groups = shared !== undefined && scope === "all" ? store.hostTabs.groups() : null;
  /** The row: the shared tabs, then this area's, or every host's in its group. */
  const row = [
    ...(shared?.tabs ?? []),
    ...(groups ? groups.flatMap((group) => group.tabs.tabs) : tabs.tabs),
  ];
  /** The host's group a tab is in, in the all-hosts row. */
  const groupOf = (tab: Tab) => groups?.find((group) => group.tabs.tabs.includes(tab));
  /** The set a tab belongs to, for what acts on the tab itself (close, pin, move). */
  const setOf = (tab: Tab): Tabs =>
    shared?.tabs.includes(tab) ? shared : (groupOf(tab)?.tabs ?? tabs);
  const sharedActive = shared !== undefined && store.hostTabs.onShared;
  const selectedTab = (tab: Tab) => {
    if (shared?.tabs.includes(tab)) return sharedActive && tab.id === shared.activeId;
    // In the all-hosts row only the tab on screen is selected, whichever host it is of.
    return !sharedActive && tab.id === (groups ? store.hostTabs.activeId : tabs.activeId);
  };
  /** The host a tab belongs to: the row's own tabs belong to the host in use, the shared ones to none. */
  const ownHost = (tab: Tab): string | null => {
    if (!shared || shared.tabs.includes(tab)) return null;
    return groupOf(tab)?.hostId ?? store.hostTabs.hostId;
  };
  const { dropOn, dragProps } = useTabDrag();
  const active = sharedActive ? undefined : tabs.tabs.find((tab) => tab.id === tabs.activeId);
  const { scrollerProps, tablist, more, step } = useStripScroll([
    tabs.activeId,
    row.length,
    sharedActive,
    shared?.activeId,
  ]);
  const { announcement, moveByKey, shift } = useTabAnnounce({
    store,
    state,
    tabs,
    shared,
    setOf,
    tablist,
  });
  const compact = row.length > COMPACT_AT;
  // No tab, no strip: the area shows the start screen alone.
  if (row.length === 0) return null;
  const activeLabel = active ? tabTitle(active, state, store) : "";
  /** Every tab of the row as the list of all tabs shows it. */
  const listRows = row.map((tab) => {
    const route = tab.router.current;
    const kind = tabKind(route);
    const host = "host" in route ? route.host : undefined;
    return {
      id: tab.id,
      title: tabTitle(tab, state, store),
      host: state.hosts.find((h) => h.id === host)?.name ?? "",
      ...(host && state.hosts.some((h) => h.id === host) ? { hostId: host } : {}),
      icon: TAB_ICONS[kind],
      kind,
      current: selectedTab(tab),
      pinned: tab.pinned,
    };
  });
  const closeFromList = (id: string) => {
    const tab = row.find((candidate) => candidate.id === id);
    if (tab) store.closeTab(setOf(tab), id);
  };
  const newTab = (
    <Button
      variant="ghost"
      size="icon"
      className="mb-0.5 size-7"
      aria-label={t("tabs.newTab")}
      onClick={() => {
        store.openNewTab();
        store.history.openSearch();
      }}
    >
      <Plus />
    </Button>
  );
  const activeMenu = active && (
    <ActiveMenu store={store} tabs={tabs} active={active} label={activeLabel} shift={shift} />
  );
  if (narrow) {
    // One button: the current tab (icon, title, its host's dot) and how many there are; it opens
    // the list of all tabs across the window. No strip to scroll, no split.
    const now = row.find(selectedTab) ?? (row[0] as Tab);
    const nowHost = ownHost(now);
    const nowTitle = tabTitle(now, state, store);
    // A host not loaded yet is not named by its id: the title stands alone.
    const nowHostName = state.hosts.find((h) => h.id === nowHost)?.name;
    const nowName = nowHostName
      ? t("tabs.named", { title: nowTitle, host: nowHostName })
      : nowTitle;
    const NowIcon = TAB_ICONS[tabKind(now.router.current)];
    return (
      <div className="tab-bar">
        <TabOverflow
          t={t}
          wide
          rows={listRows}
          onPick={(id) => store.hostTabs.activate(id)}
          onClose={closeFromList}
          trigger={
            <button
              type="button"
              aria-label={t("tabs.currentTab", { n: row.length, title: nowName })}
              className="tab-current"
            >
              <NowIcon aria-hidden="true" />
              {nowHost && <HostDot hostId={nowHost} />}
              <span data-slot="tab-title">{nowTitle}</span>
              <span data-slot="tab-count">{row.length}</span>
              <ChevronDown aria-hidden="true" />
            </button>
          }
        />
        {activeMenu}
        {newTab}
        {/* Only a window already split offers its buttons here: to join the areas again. */}
        {store.workspace.split && props.children}
        <output aria-label={t("tabs.position")} className="sr-only">
          {announcement}
        </output>
      </div>
    );
  }
  return (
    <div className="tab-bar">
      {/* Only tabs (and the presentation wrappers that hold them) in the tablist; the move and pin buttons act on the active tab and sit after it. */}
      {more.left && (
        <Button
          variant="ghost"
          size="icon"
          className="tab-tool"
          aria-label={t("tabs.scrollLeft")}
          onClick={() => step(-1)}
        >
          <ChevronLeft />
        </Button>
      )}
      <div {...scrollerProps} className="tab-scroller">
        <div ref={tablist} role="tablist" aria-label={t("tabs.list")} className="tab-strip">
          {row.map((tab) => {
            const own = setOf(tab);
            const selected = selectedTab(tab);
            const group = groupOf(tab);
            const { label, kind, Icon, badge, cacheSince, ssh, prod, hostColor, ariaLabel } =
              tabFacts(tab, { t, state, store, host: ownHost(tab) });
            const startsGroup = group?.tabs.tabs[0] === tab;
            return (
              <Fragment key={tab.id}>
                {startsGroup && (
                  // Only for the eyes: each tab of the group already says its host in its name.
                  <span data-slot="tab-group" aria-hidden="true" className="tab-group">
                    <HostDot hostId={group.hostId} />
                    {state.hosts.find((h) => h.id === group.hostId)?.name ?? ""}
                  </span>
                )}
                {/* The wrapper is invisible to the tablist: the tab and its × are siblings inside it. */}
                <div // NOSONAR: the wrapper is invisible to the tablist: the tab and its × are siblings inside it
                  role="presentation"
                  {...tabItemMarks(tab, {
                    prod,
                    hostColor,
                    drop: dropOn?.id === tab.id ? dropOn.side : null,
                  })}
                >
                  <IconTip label={label}>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      data-preview={tab.preview}
                      {...(tab.preview ? { "aria-description": t("tabs.preview") } : {})}
                      data-tab-id={tab.id}
                      aria-keyshortcuts={`${tab.pinned ? "" : "Delete "}${MOVE_KEYS}`}
                      // A pinned tab shows no title, and a host's tab no longer carries its host's name
                      // in it: the name is set here, with the badge's words.
                      {...(ariaLabel ? { "aria-label": ariaLabel } : {})}
                      className="tab-button"
                      onClick={() => store.hostTabs.activate(tab.id)}
                      onDoubleClick={() => own.commit(tab.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Delete") store.closeTab(own, tab.id);
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
                        store.closeTab(own, tab.id);
                      }}
                      {...dragProps(tab, own)}
                    >
                      <Icon data-icon={kind} className="size-3.5 shrink-0" aria-hidden />
                      {!tab.pinned && (
                        <span className={cn("truncate", tab.preview && "italic")}>{label}</span>
                      )}
                      {!tab.pinned &&
                        ssh?.tags.map((tag) => (
                          <span key={tag} className="shrink-0 rounded bg-muted px-1 text-xs">
                            {tag}
                          </span>
                        ))}
                      {badge && <TabBadgeGlyph badge={badge} label={t(`tabs.badge.${badge}`)} />}
                    </button>
                  </IconTip>
                  {cacheSince && (
                    <span className="absolute top-0.5 left-0.5">
                      <CacheTimer store={store} since={cacheSince} compact />
                    </span>
                  )}
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
                      onClick={() => store.closeTab(own, tab.id)}
                    >
                      <X className="size-3.5" aria-hidden />
                    </button>
                  )}
                </div>
              </Fragment>
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
          onClick={() => step(1)}
        >
          <ChevronRight />
        </Button>
      )}
      {compact && (
        <TabOverflow
          t={t}
          rows={listRows}
          onPick={(id) => store.hostTabs.activate(id)}
          onClose={closeFromList}
        />
      )}
      {activeMenu}
      {newTab}
      {props.children}
      <output aria-label={t("tabs.position")} className="sr-only">
        {announcement}
      </output>
    </div>
  );
}
