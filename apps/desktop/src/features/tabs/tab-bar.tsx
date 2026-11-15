import { ChevronDown, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Fragment, type ReactNode, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { HostDot } from "@/features/hosts/ui.ts";
import { tabKind } from "@/features/shell/index.ts";
import { useBreakpoint } from "@/shared/hooks/index.ts";
import type { AppState, AppStore } from "../../lib/app-store.ts";
import { TAB_ICONS, tabFacts, tabTitle } from "./tab-facts.ts";
import { TabItem } from "./tab-item.tsx";
import { ActiveMenu } from "./tab-menu.tsx";
import { TabOverflow } from "./tab-overflow.tsx";
import type { Tab, Tabs } from "./tabs.ts";
import { useStripScroll } from "./use-strip-scroll.ts";
import { useTabAnnounce } from "./use-tab-announce.ts";
import { useTabDrag } from "./use-tab-drag.ts";

/** Past this many tabs the badges shrink to dots and the strip offers a menu of all of them. */
const COMPACT_AT = 8;

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
                <TabItem
                  store={store}
                  tab={tab}
                  own={own}
                  selected={selected}
                  facts={tabFacts(tab, { t, state, store, host: ownHost(tab) })}
                  drag={dragProps(tab, own)}
                  drop={dropOn?.id === tab.id ? dropOn.side : null}
                  onMoveByKey={(delta) => moveByKey(tab, delta)}
                />
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
