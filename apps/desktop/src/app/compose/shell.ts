import { PaletteSlice } from "@/features/palette/palette-store.ts";
import { DensityController } from "@/features/shell/density.ts";
import { ShellPrefs } from "@/features/shell/shell-prefs.ts";
import { SidebarFoldController } from "@/features/shell/sidebar-fold.ts";
import { ThemeController } from "@/features/shell/theme.ts";
import { type ActivitySlice, wireActivity } from "../../features/activity/index.ts";
import { type AppUpdateSlice, wireAppUpdates } from "../../features/appupdate/index.ts";
import { WhatsNew } from "../../features/appupdate/whats-new.ts";
import type { BackgroundSlice } from "../../features/background/index.ts";
import { BoardWidth } from "../../features/board/index.ts";
import { DataScopeController } from "../../features/costs/index.ts";
import { type HistorySlice, wireHistory } from "../../features/history/index.ts";
import { HomeCache, UiModeSlice } from "../../features/home/index.ts";
import { RequestError } from "../../features/hosts/index.ts";
import type { InboxSlice } from "../../features/inbox/index.ts";
import { AwayClock } from "../../features/needs-you/away.ts";
import { QuietSnoozeSlice } from "../../features/needs-you/quiet-snooze.ts";
import { NotifyPreferences } from "../../features/notifications/index.ts";
import { type PermissionsSlice, wirePermissions } from "../../features/permissions/index.ts";
import {
  browserClockDeps,
  CacheTimerSettings,
  type ExternalSessionsSlice,
  type FinishedSlice,
  HISTORY_LIST_LIMIT,
  NewSessionPrefs,
  type SessionActions,
  type SessionCommandsSlice,
  type SessionListsSlice,
  type SessionStreamSlice,
  type SessionSubscriptions,
  type SessionsSlice,
  SharedClock,
  type SummariesSlice,
  sessionKey,
  wireExternalSessions,
  wireFinished,
  wireSessionActions,
  wireSessionCommands,
  wireSessionLists,
  wireSessionStream,
  wireSessionSubscriptions,
  wireSessions,
  wireSummaries,
} from "../../features/sessions/index.ts";
import { type SettingsSlice, wireSettings } from "../../features/settings/index.ts";
import { TabScopeController } from "../../features/tabs/tab-scope.ts";
import { TabOrderController } from "../../features/tabs/tab-switcher.ts";
import {
  TerminalFontController,
  TerminalReaderSetting,
} from "../../features/terminal/terminal-view.ts";
import { type TraySlice, wireTray } from "../../features/tray/index.ts";
import { ViewPrefsSlice } from "../../features/viewprefs/index.ts";
import type { WebhookFeed } from "../../features/webhook/webhook-feed.ts";
import { type AppState, type HostView, needsYou } from "../../lib/app-state.ts";
import type { AppKernel } from "../../lib/kernel.ts";
import type { Platform } from "../../platform/types.ts";
import { AppLog } from "../app-log.ts";

/** What the app does with the sessions of the hosts: their lists, stream, commands, answers and the tray that shows them (#2376). */
interface SessionSlices {
  /** The tray and the window title that follow the state (phase 8, issue #88, #1596). */
  readonly tray: TraySlice;
  /** Answering a permission request, with the hold a high-risk allow needs (#245, #1596). */
  readonly permissions: PermissionsSlice;
  /** What a host's session summaries tell the person, and the teams whose workers it folds (#1596). */
  readonly summaries: SummariesSlice;
  /** What a host tells about the Claude sessions started in a terminal (#1596). */
  readonly external: ExternalSessionsSlice;
  /** What the Sessions screen lists from the online hosts (#1596). */
  readonly sessionLists: SessionListsSlice;
  /** The sessions that finished, as Needs you lists them, kept between runs (#1596). */
  readonly finished: FinishedSlice;
  /** What a host's session events do to the conversations the app holds (#1596). */
  readonly stream: SessionStreamSlice;
  /** The sessions that keep their full event stream: the open one and the followed (#1596). */
  readonly subscriptions: SessionSubscriptions;
  /** What a person asks of a session: make one, send, interrupt, change mode, close, resume (#1596). */
  readonly commands: SessionCommandsSlice;
  /** What a conversation screen asks of the app: the commands, copying a text, answering a request. */
  readonly sessionActions: SessionActions;
  /** The history read from every host (#1596): its global search. */
  readonly history: HistorySlice;
  /** What happened on the hosts while the app was away (issue #1344, #1596). */
  readonly activity: ActivitySlice;
  /** The sessions a restart interrupted, and the offer to resume them (issue #150, #1596). */
  readonly sessions: SessionsSlice;
}

/** The shell preferences, what the person set for the window and what the app keeps about itself, and the session slices that read them (#2376). */
export interface ShellSlices extends SessionSlices {
  /** Light, dark or the system's (phase 10). */
  readonly theme: ThemeController;
  readonly density: DensityController;
  readonly terminalFont: TerminalFontController;
  readonly terminalReader: TerminalReaderSetting;
  /** The prompt cache countdown on idle sessions: off by default (issue #159). */
  readonly cacheTimer: CacheTimerSettings;
  /** One 1-second clock for every countdown on screen. */
  readonly clock: SharedClock;
  /** How Ctrl+Tab orders the tabs (issue #148). */
  readonly tabOrder: TabOrderController;
  /** Whether the tab row shows one host's tabs or every host's (issue #644). */
  readonly tabScope: TabScopeController;
  readonly sidebarFold: SidebarFoldController;
  /** Whose data Home (and later Sessions, Costs, Board) show: every host or one (#126). */
  readonly dataScope: DataScopeController;
  /** What the shell hides: the New and Beta badges, What's new (issue #282). */
  readonly shellPrefs: ShellPrefs;
  /** What the New session form starts from: the last mode, model and folder (issue #1135). */
  readonly newSessionPrefs: NewSessionPrefs;
  /** The board columns' width, one for all, kept across starts (issue #161). */
  readonly boardWidth: BoardWidth;
  /** What the person chose about notifications: events, mutes, team folding, sound (issue #149). */
  readonly notifyPrefs: NotifyPreferences;
  /** How the person left the windows: widths, folds, hub view and filter, tile layout (#1596). */
  readonly viewPrefs: ViewPrefsSlice;
  /** Which mode the window shows, simple or full, per host (phase 33). */
  readonly uiModes: UiModeSlice;
  /** What the command palette loads and the entries it used lately (#1596). */
  readonly palette: PaletteSlice;
  /** "Not stuck" on a quiet session (`features/needs-you/quiet-snooze.ts`). */
  readonly quietSnooze: QuietSnoozeSlice;
  /** Home's last numbers per host set and period (issue #607). */
  readonly homeCache: HomeCache;
  /** Whether the release notes of an update were not opened yet (issue #125). */
  readonly whatsNew: WhatsNew;
  /** The app's own update: the check, the background download, the install and the one on quit (#1596). */
  readonly appUpdates: AppUpdateSlice;
  /** Issue #1344: when the app was last active, read before this start writes its own. */
  readonly awayClock: AwayClock;
  /** The app's log: what happens to hosts, refusals and updates goes through it (issue #255). */
  readonly appLog: AppLog;
  readonly settings: SettingsSlice;
}

type PaletteDeps = ConstructorParameters<typeof PaletteSlice>[0];
type SummariesDeps = Parameters<typeof wireSummaries>[1];

/** What the shell slices read from the rest of the store; each is read when a slice asks, so a slice built later is fine. */
interface ShellDeps {
  platform: Platform;
  /** The delay between the app's own update checks; `undefined` keeps the slice's default. */
  appUpdateIntervalMs: () => number | undefined;
  /** Changes one host's view in the state. */
  updateHost: (hostId: string, change: (host: HostView) => HostView) => void;
  /** The values the log must never write: vault values and host tokens. */
  secretValues: () => string[];
  /** A time of day in the person's language and zone. */
  formatTime: (iso: string) => string;
  /** The global search the settings shortcut opens. */
  openSearch: () => void;
  /** What the palette loads before it lists, each from its own domain. */
  palette: Pick<
    PaletteDeps,
    | "loadProjects"
    | "loadBoard"
    | "loadSshTargets"
    | "loadPersonas"
    | "listSnippets"
    | "keepSnippets"
    | "refreshHub"
  >;
  /** The longest a global search waits for a host; `undefined` keeps the slice's default. */
  searchTimeoutMs: number | undefined;
  /** The timers the tray's countdowns run on. */
  timers: Parameters<typeof wireTray>[1]["timers"];
  /** Opens a session's tab. */
  showSession: (hostId: string, sessionId: string) => void;
  /** Settles a vault request the permission answer carries. */
  settleVault: Parameters<typeof wirePermissions>[1]["settleVault"];
  /** Tells the background tasks slice a host's session list changed. */
  backgroundChanged: BackgroundSlice["changed"];
  /** What the webhooks are told, read when an event asks. */
  webhookFeed: () => WebhookFeed;
  /** The notification center (the bell). */
  notify: InboxSlice["notify"];
  /** Copies a text through the machine's clipboard slice. */
  copyText: (text: string) => Promise<boolean>;
  /** The project a folder of a host belongs to. */
  projectOf: SummariesDeps["projectOf"];
  /** The sessions on screen: the open tab's and the visible ones'. */
  shown: SummariesDeps["shown"];
  /** Runs a function after a delay, on the store's timers. */
  later: SummariesDeps["later"];
  /** Answers a permission request of a host from the tray or a toast. */
  respondTo: Parameters<typeof wireTray>[1]["answer"];
}

/**
 * Builds the shell preferences and the session slices that read them. Every slice is built through
 * its own domain's entry; the store keeps only what it owns (#2376).
 */
export function composeShell(kernel: AppKernel<AppState>, deps: ShellDeps): ShellSlices {
  const { platform } = deps;
  const appLog = new AppLog({ sink: platform.logs, values: deps.secretValues });
  const shell = {
    theme: new ThemeController(platform),
    density: new DensityController(platform.storage),
    terminalFont: new TerminalFontController(platform.storage),
    terminalReader: new TerminalReaderSetting(platform.storage),
    cacheTimer: new CacheTimerSettings(platform.storage),
    clock: new SharedClock(
      browserClockDeps(kernel.now, typeof document === "undefined" ? undefined : document),
    ),
    tabOrder: new TabOrderController(platform.storage),
    tabScope: new TabScopeController(platform.storage),
    sidebarFold: new SidebarFoldController(platform.storage),
    dataScope: new DataScopeController(platform.storage),
    shellPrefs: new ShellPrefs(platform.storage),
    newSessionPrefs: new NewSessionPrefs(platform.storage),
    boardWidth: new BoardWidth(platform.storage),
    notifyPrefs: new NotifyPreferences(platform.storage),
    viewPrefs: new ViewPrefsSlice({ storage: platform.storage }),
    uiModes: new UiModeSlice({
      hosts: () => kernel.state().hosts,
      selectedHostId: () => kernel.state().selected?.hostId ?? null,
      choices: () => kernel.state().uiChoices,
      storage: platform.storage,
      setChoices: (uiChoices) => kernel.update({ uiChoices }),
      setHostUi: (hostId, patch) =>
        kernel.hostCommand(hostId, "ui.set", { ...patch, confirm: true }),
      recordHostUi: (hostId, ui) =>
        deps.updateHost(hostId, (h) =>
          h.hostInfo ? { ...h, hostInfo: { ...h.hostInfo, ui } } : h,
        ),
    }),
    palette: new PaletteSlice({
      hosts: () => kernel.state().hosts,
      storage: platform.storage,
      ...deps.palette,
    }),
    quietSnooze: new QuietSnoozeSlice({
      snoozes: () => kernel.state().quietSnooze,
      setSnoozes: (quietSnooze) => kernel.update({ quietSnooze }),
      storage: platform.storage,
      now: () => kernel.now(),
      key: sessionKey,
      t: () => kernel.t(),
      formatTime: deps.formatTime,
      success: (text) => kernel.success(text),
    }),
    homeCache: new HomeCache(platform.storage),
    whatsNew: new WhatsNew(platform.storage),
    appUpdates: wireAppUpdates(kernel, {
      updater: () => platform.updater,
      intervalMs: deps.appUpdateIntervalMs,
      log: (level, source, message) => appLog.log(level, source, message),
      quitNow: () => platform.quitNow(),
    }),
    awayClock: new AwayClock(platform.storage, kernel.now),
    appLog,
    settings: wireSettings(kernel, { platform, onShortcut: deps.openSearch }),
  };
  return { ...shell, ...composeSessions(kernel, deps, shell) };
}

/**
 * Builds the session slices. They refer to each other through closures that run only after this
 * function returns, so a `const` declared further down is read late, never during construction.
 * No `wire*` call reads another slice or the state while it is built, so the order below is free;
 * the store builds this group first, ahead of the hosts and the vault.
 */
function composeSessions(
  kernel: AppKernel<AppState>,
  deps: ShellDeps,
  shell: Pick<ShellSlices, "uiModes" | "notifyPrefs" | "awayClock">,
): SessionSlices {
  const { platform } = deps;
  const needsYouNow = () => needsYou(kernel.state(), kernel.t());
  const isSimple = (hostId: string) => shell.uiModes.mode(hostId).mode === "simple";
  const subscriptions = wireSessionSubscriptions(kernel);
  const history = wireHistory(kernel, {
    searchTimeoutMs: deps.searchTimeoutMs,
    select: (hostId, sessionId) => subscriptions.select(hostId, sessionId),
    listLimit: HISTORY_LIST_LIMIT,
    offline: () => new RequestError("offline", "unknown host"),
    reason: (error) => (error instanceof RequestError ? error.reason : undefined),
  });
  const commands = wireSessionCommands(kernel, {
    opened: (hostId, sessionId) => {
      subscriptions.select(hostId, sessionId);
      // A new session opens, wherever it was created from (phase 10).
      history.closeSearch();
      deps.showSession(hostId, sessionId);
    },
  });
  const tray: TraySlice = wireTray(kernel, {
    platform,
    needsYou: needsYouNow,
    uiHostId: () => shell.uiModes.hostId(),
    isSimple,
    answer: deps.respondTo,
    open: (item) => permissions.open(item),
    timers: deps.timers,
  });
  const permissions: PermissionsSlice = wirePermissions(kernel, {
    needsYou: needsYouNow,
    settleVault: deps.settleVault,
    sendSelected: (response) =>
      commands.onSelected((conn) => conn.request("permission.respond", response)),
    showWindow: () => void platform.showMainWindow(),
    act: (action) => tray.act(action),
  });
  const finished = wireFinished(kernel, {
    storage: platform.storage,
    isFocused: () => platform.isFocused(),
    shown: deps.shown,
  });
  const summaries: SummariesSlice = wireSummaries(kernel, {
    setSessions: (hostId, sessions) => deps.updateHost(hostId, (h) => ({ ...h, sessions })),
    shown: deps.shown,
    projectOf: deps.projectOf,
    isSimple,
    isFocused: () => platform.isFocused(),
    prefs: () => shell.notifyPrefs.value,
    notify: deps.notify,
    feed: (host, prev, next) => deps.webhookFeed().managed(host, prev, next),
    finished: (hostId, prev, next) => finished.record(hostId, prev, next),
    later: deps.later,
  });
  return {
    tray,
    permissions,
    summaries,
    finished,
    subscriptions,
    commands,
    history,
    sessionActions: wireSessionActions(commands, {
      copyText: deps.copyText,
      respond: (requestId, decision, answer) =>
        permissions.respond(requestId, decision, answer ?? {}),
    }),
    external: wireExternalSessions(kernel, {
      projectOf: deps.projectOf,
      isFocused: () => platform.isFocused(),
      notify: deps.notify,
      feedSession: (host, prev, next) => deps.webhookFeed().externalSession(host, prev, next),
      feedPermission: (host, frame, cwd) => deps.webhookFeed().externalPermission(host, frame, cwd),
    }),
    sessionLists: wireSessionLists(kernel, { backgroundPatch: deps.backgroundChanged }),
    stream: wireSessionStream(kernel, {
      summary: (hostId, event) => summaries.apply(hostId, [event]),
    }),
    activity: wireActivity(kernel, { since: () => shell.awayClock.since() }),
    sessions: wireSessions(kernel, { storage: platform.storage }),
  };
}
