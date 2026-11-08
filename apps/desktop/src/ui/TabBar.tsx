import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  BookOpen,
  Bot,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleAlert,
  LoaderCircle,
  type LucideIcon,
  MessageSquare,
  MoreHorizontal,
  Pin,
  PinOff,
  Plus,
  SquareKanban,
  SquareTerminal,
  X,
} from "lucide-react";
import {
  type CSSProperties,
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { IconTip } from "@/components/feedback/icon-tip";
import { HostDot } from "@/components/hosts/host-dot";
import { CacheTimer } from "@/components/hub/cache-timer";
import { NAV_ICONS } from "@/components/nav-icons";
import { TabOverflow } from "@/components/tabs/tab-overflow";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useBreakpoint } from "@/hooks/use-breakpoint";
import { cn } from "@/lib/utils";
import type { AppState, AppStore } from "../lib/app-store.ts";
import { breadcrumb } from "../lib/breadcrumb.ts";
import { hostColorVar } from "../lib/host-color.ts";
import { isProd } from "../lib/ssh.ts";
import {
  badgePulses,
  type TabBadge,
  type TabKind,
  tabBadge,
  tabIdleSince,
  tabKind,
} from "../lib/tab-badge.ts";
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
/** How a tab is moved from the keyboard. */
const MOVE_KEYS = "Control+Shift+ArrowLeft Control+Shift+ArrowRight";

/** What a terminal tab says about the ssh destino it was opened from, if it was. */
const sshOf = (tab: Tab, store: AppStore) => {
  const route = tab.router.current;
  return route.name === "terminal"
    ? store.sshTerminals.get(`${route.host}/${route.terminalId}`)
    : undefined;
};

/**
 * The title of a tab: the last step of the path its route shows in the header. A host's Overview and
 * History end in the host's name, which the row already says (it belongs to that host): they show
 * their section instead (issue #644).
 */
const title = (tab: Tab, state: AppState, store: AppStore) => {
  const ssh = sshOf(tab, store);
  if (ssh) return store.i18n.t("terminalUi.sshBadge", { name: ssh.name });
  const route = tab.router.current;
  if (route.name === "host") return store.i18n.t("hostHome.overview");
  if (route.name === "history") return store.i18n.t("sidebar.history");
  return breadcrumb(route, state, store.i18n.t).at(-1)?.label ?? "";
};

// The Ctrl+Tab switcher draws the same icon and title as the strip.
export { ICONS as TAB_ICONS, title as tabTitle };

type TabFacts = {
  t: AppStore["i18n"]["t"];
  state: AppState;
  store: AppStore;
  /** The host the tab belongs to; the shared tabs belong to none. */
  host: string | null;
};

/** What a tab of the strip shows and says: its name, kind, badge, server and the words a screen reader gets. */
function tabFacts(tab: Tab, at: TabFacts) {
  const { t, state, store, host } = at;
  const label = title(tab, state, store);
  const kind = tabKind(tab.router.current);
  const badge = tabBadge(tab.router.current, state);
  const pinnedLabel = badge ? `${label}, ${t(`tabs.badge.${badge}`)}` : label;
  const ssh = sshOf(tab, store);
  const hostName = host ? (state.hosts.find((h) => h.id === host)?.name ?? host) : undefined;
  // A pinned tab shows no title, and a host's tab no longer carries its host's name in it: the
  // name is set here, with the badge's words.
  const pinnedName = tab.pinned ? pinnedLabel : undefined;
  return {
    label,
    kind,
    Icon: ICONS[kind],
    badge,
    cacheSince: tabIdleSince(tab.router.current, state),
    ssh,
    // A production server is easy to mistake for another: its tab gets a red border.
    prod: ssh ? isProd(ssh.tags) : undefined,
    // The host's tabs carry its color.
    hostColor: host ? hostColorVar(host) : undefined,
    ariaLabel: hostName ? t("tabs.named", { title: pinnedLabel, host: hostName }) : pinnedName,
  };
}

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
  /** The tab being dragged to a new place. */
  const dragged = useRef<string | null>(null);
  /** The tab a drag is over and the side the dragged one will land on, to mark the place. */
  const [dropOn, setDropOn] = useState<{ id: string; side: "before" | "after" } | null>(null);
  /** What a screen reader is told about the last move or the host the row switched to. */
  const [announcement, setAnnouncement] = useState("");
  // The first area's row says which host it switched to and how many tabs it has, once, by its name.
  // A window that opens on a host says nothing, and neither does a host not loaded yet: the id is
  // not a name a person knows.
  const rowHost = shared ? store.hostTabs.hostId : null;
  const rowName = state.hosts.find((h) => h.id === rowHost)?.name ?? null;
  const hostTabCount = rowHost ? store.hostTabs.tabCount(rowHost) : 0;
  const announcedHost = useRef<string | null | undefined>(undefined);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new tab in the same host does not speak
  useEffect(() => {
    if (announcedHost.current === undefined) {
      announcedHost.current = rowHost;
      return;
    }
    if (!rowHost || rowName === null || announcedHost.current === rowHost) return;
    announcedHost.current = rowHost;
    setAnnouncement(t("tabs.hostCount", { host: rowName, n: hostTabCount }));
  }, [rowHost, rowName]);
  /** The tab a keyboard move just went off with: the focus goes back to it. */
  const focusTab = useRef<string | null>(null);
  const active = sharedActive ? undefined : tabs.tabs.find((tab) => tab.id === tabs.activeId);
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
  const compact = row.length > COMPACT_AT;
  // The active tab is always in view; the strip is measured again when the tabs change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the active tab and the count are the triggers
  useEffect(() => {
    tablist.current
      ?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    measure();
  }, [tabs.activeId, row.length, sharedActive, shared?.activeId, measure]);
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
  // No tab, no strip: the area shows the start screen alone.
  if (row.length === 0) return null;
  const shift = (id: string, delta: -1 | 1) => {
    tabs.shift(id, delta);
    refocusTab.current = !tabs.canShift(id, delta);
  };
  /** Moves a tab one place with the keyboard and says where it went. */
  const moveByKey = (tab: Tab, delta: -1 | 1) => {
    const own = setOf(tab);
    if (!own.canShift(tab.id, delta)) return;
    own.shift(tab.id, delta);
    focusTab.current = tab.id;
    setAnnouncement(
      t("tabs.moved", {
        title: title(tab, state, store),
        n: own.tabs.findIndex((other) => other.id === tab.id) + 1,
        total: own.tabs.length,
      }),
    );
  };
  const activeLabel = active ? title(active, state, store) : "";
  /** Every tab of the row as the list of all tabs shows it. */
  const listRows = row.map((tab) => {
    const route = tab.router.current;
    const kind = tabKind(route);
    const host = "host" in route ? route.host : undefined;
    return {
      id: tab.id,
      title: title(tab, state, store),
      host: state.hosts.find((h) => h.id === host)?.name ?? "",
      ...(host && state.hosts.some((h) => h.id === host) ? { hostId: host } : {}),
      icon: ICONS[kind],
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
        store.openSearch();
      }}
    >
      <Plus />
    </Button>
  );
  /** The current tab's menu: move, pin and the rest, at the end of the strip and of the narrow row. */
  const activeMenu = active && (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="mb-0.5 size-7"
          aria-label={t("tabs.actions", { title: activeLabel })}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          disabled={!tabs.canShift(active.id, -1)}
          onSelect={() => shift(active.id, -1)}
        >
          <ArrowLeft aria-hidden="true" />
          {t("tabs.moveLeft", { title: activeLabel })}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!tabs.canShift(active.id, 1)}
          onSelect={() => shift(active.id, 1)}
        >
          <ArrowRight aria-hidden="true" />
          {t("tabs.moveRight", { title: activeLabel })}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => store.workspace.moveToOtherArea(active.id)}>
          <ArrowLeftRight aria-hidden="true" />
          {t("tabs.moveToOther", { title: activeLabel })}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => tabs.pin(active.id, !active.pinned)}>
          {active.pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
          {t(active.pinned ? "tabs.unpin" : "tabs.pin", { title: activeLabel })}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  if (narrow) {
    // One button: the current tab (icon, title, its host's dot) and how many there are; it opens
    // the list of all tabs across the window. No strip to scroll, no split.
    const now = row.find(selectedTab) ?? (row[0] as Tab);
    const nowHost = ownHost(now);
    const nowTitle = title(now, state, store);
    // A host not loaded yet is not named by its id: the title stands alone.
    const nowHostName = state.hosts.find((h) => h.id === nowHost)?.name;
    const nowName = nowHostName
      ? t("tabs.named", { title: nowTitle, host: nowHostName })
      : nowTitle;
    const NowIcon = ICONS[tabKind(now.router.current)];
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
          {row.map((tab) => {
            const own = setOf(tab);
            const selected = selectedTab(tab);
            const group = groupOf(tab);
            const { label, kind, Icon, badge, cacheSince, ssh, prod, hostColor, ariaLabel } =
              tabFacts(tab, { t, state, store, host: ownHost(tab) });
            const startsGroup = group !== undefined && group.tabs.tabs[0] === tab;
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
                      draggable
                      onDragStart={() => {
                        dragged.current = tab.id;
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        const from = own.tabs.findIndex((other) => other.id === dragged.current);
                        if (from < 0 || own.tabs[from]?.id === tab.id) return setDropOn(null);
                        setDropOn({
                          id: tab.id,
                          side: from < own.tabs.indexOf(tab) ? "after" : "before",
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
                        if (id && own.tabs.some((other) => other.id === id))
                          own.move(id, own.tabs.indexOf(tab));
                      }}
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
          onClick={() => scrollBy(STEP)}
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

/** Each badge's shape: a sign besides its color (issue #172, WCAG 1.4.1). */
const BADGE_GLYPHS: Record<NonNullable<TabBadge>, { icon: LucideIcon; className: string }> = {
  "needs-you": { icon: CircleAlert, className: "text-status-needs-you" },
  running: { icon: LoaderCircle, className: "text-muted-foreground" },
  unread: { icon: Circle, className: "text-primary [&_svg]:fill-current" },
};

/**
 * A tab's badge: a glyph named in words (for screen readers and in its tooltip), never a text
 * pill, so the tab's title keeps the width.
 */
export function TabBadgeGlyph(props: Readonly<{ badge: NonNullable<TabBadge>; label: string }>) {
  const glyph = BADGE_GLYPHS[props.badge];
  const Glyph = glyph.icon;
  return (
    <span
      role="img"
      data-badge={props.badge}
      aria-label={props.label}
      title={props.label}
      className={cn(
        "tab-badge",
        glyph.className,
        badgePulses(props.badge) && "motion-safe:animate-spin",
      )}
    >
      <Glyph aria-hidden="true" className={props.badge === "unread" ? "size-2.5" : "size-3.5"} />
    </span>
  );
}
