import type {
  Card,
  ChangesUpdated,
  CommandPayload,
  CommandResults,
  EffortLevel,
  HistoryChanged,
  HistoryGetResult,
  HistoryListResult,
  MessageInfo,
  RunConfigInfo,
  RunState,
  SessionImage,
  SessionMeta,
  SessionRecap,
  SettableMode,
  TeamsUpdatedFrame,
  WorkflowRun,
} from "@flightdeck/protocol";
import { FEATURE_RESUME_OFFER, inSequence } from "@flightdeck/protocol";
import { DensityController } from "@/features/shell/density.ts";
import { ShellPrefs } from "@/features/shell/shell-prefs.ts";
import { SidebarFoldController } from "@/features/shell/sidebar-fold.ts";
import { ThemeController } from "@/features/shell/theme.ts";
import { WORKSPACE_KEY, Workspace } from "@/features/shell/workspace.ts";
import { basename, isInside } from "@/shared/lib/index.ts";
import { type AccountSlice, initialAccountState, wireAccount } from "../features/account/index.ts";
import {
  type ActivitySlice,
  initialActivityState,
  wireActivity,
} from "../features/activity/index.ts";
import {
  type AppUpdateSlice,
  initialAppUpdateState,
  wireAppUpdates,
} from "../features/appupdate/index.ts";
import { WhatsNew } from "../features/appupdate/whats-new.ts";
import {
  type BackgroundSlice,
  initialBackgroundState,
  wireBackground,
} from "../features/background/index.ts";
import { BackupSlice } from "../features/backup/index.ts";
import { type ClientScopeSlice, wireClientScope } from "../features/clients/index.ts";
import {
  type BudgetsSlice,
  type ClientBudgetsSlice,
  initialBudgetsState,
  initialClientBudgetsState,
  wireBudgets,
  wireClientBudgets,
} from "../features/costs/index.ts";
import { type HistorySlice, initialHistoryState, wireHistory } from "../features/history/index.ts";
import {
  type ConnectionStatus,
  type HealthSlice,
  type HostConfig,
  HostConnection,
  HostRosterSlice,
  HostTabs,
  type HostUpdateSlice,
  initialHealthState,
  loadHosts,
  type NewHost,
  RequestError,
  saveHosts,
  statusLine,
  wireHealth,
  wireHostUpdate,
} from "../features/hosts/index.ts";
import { type InboxSlice, wireInbox } from "../features/inbox/index.ts";
import {
  initialMessagingState,
  type MessagingSlice,
  wireMessaging,
} from "../features/messaging/index.ts";
import { AwayClock } from "../features/needs-you/away.ts";
import { loadQuietSnooze, saveQuietSnooze } from "../features/needs-you/quiet-snooze.ts";
import { NotifyPreferences } from "../features/notifications/index.ts";
import { PermissionsSlice } from "../features/permissions/index.ts";
import {
  initialPersonasState,
  type PersonasSlice,
  wirePersonas,
} from "../features/personas/index.ts";
import { type ProjectsSlice, wireProjects } from "../features/projects/index.ts";
import { initialQuotaState, type QuotaSlice, wireQuota } from "../features/quota/index.ts";
import { type RoiSlice, wireRoi } from "../features/roi/index.ts";
import {
  type ExternalSessionsSlice,
  type Finish,
  finishOutcome,
  HISTORY_LIST_LIMIT,
  hubRows,
  initialSessionsState,
  loadFinished,
  recordFinish,
  type SessionCommandsSlice,
  type SessionListsSlice,
  type SessionStreamSlice,
  type SessionsSlice,
  SessionViews,
  type SummariesSlice,
  saveFinished,
  sessionKey,
  takeHubHost,
  wireExternalSessions,
  wireSessionCommands,
  wireSessionLists,
  wireSessionStream,
  wireSessions,
  wireSummaries,
  withFiles,
} from "../features/sessions/index.ts";
import {
  initialSettingsState,
  type SettingsSlice,
  wireSettings,
} from "../features/settings/index.ts";
import {
  initialSnippetsState,
  type SnippetsSlice,
  wireSnippets,
} from "../features/snippets/index.ts";
import { initialSshState, type SshSlice, wireSsh } from "../features/ssh/index.ts";
import {
  type TeleportOutcome,
  type TeleportRequest,
  type TeleportRunArgs,
  teleportSession,
} from "../features/teleport/teleport.ts";
import { type TerminalsSlice, wireTerminals } from "../features/terminal/index.ts";
import { type TraySlice, wireTray } from "../features/tray/index.ts";
import {
  checkDelivery,
  type DeliveryRefusal,
  Vault,
  type VaultApprovalsSlice,
  VaultRules,
  type VaultRulesSlice,
  VaultScanSlice,
  type VaultSecretsSlice,
  VaultUsageLog,
  wireVaultApprovals,
  wireVaultRules,
  wireVaultSecrets,
} from "../features/vault/index.ts";
import { ViewPrefsSlice } from "../features/viewprefs/index.ts";
import { type WatchSlice, wireWatch } from "../features/watch/index.ts";
import { WebhookFeed } from "../features/webhook/webhook-feed.ts";
import { Webhooks } from "../features/webhook/webhooks.ts";
import { refusalText } from "../i18n/errors.ts";
import { formatDateTime, formatTime, formatWhen } from "../i18n/format.ts";
import { I18n, type Key } from "../i18n/index.ts";
import type { Platform, WebhookRequest, WebhookResponse } from "../platform/types.ts";
import { AppLog } from "./app-log.ts";
import type {
  Answer,
  AppState,
  AppStoreOptions,
  GateRef,
  HistoryFilter,
  HostView,
  Notice,
  PendingItem,
  ReleaseNotesResult,
  SidebarSession,
} from "./app-state.ts";
import { HISTORY_PAGE, needsYou } from "./app-state.ts";
import { AssistantController, type HostAnswer } from "./assistant.ts";
import { type Attention, BackupScheduler } from "./backup-scheduler.ts";
import { BoardWidth } from "./board-select.ts";
import { browserClockDeps, CacheTimerSettings, SharedClock } from "./cache-timer.ts";
import { knownProjects } from "./client-rules.ts";
import { loadSelection } from "./client-scope.ts";
import { Clients, UNASSIGNED } from "./clients.ts";
import { localDay } from "./costs.ts";
import { DataScopeController, hubHostScope } from "./data-scope.ts";
import { googleConfig } from "./google-config.ts";
import { HomeCache } from "./home-cache.ts";
import type { AppKernel, HostCommandOptions, HostCommandType, HostResult } from "./kernel.ts";
import { NewSessionPrefs } from "./new-session-prefs.ts";
import { sameNotice } from "./notice-lifetime.ts";
import { ProjectKeys } from "./project-keys.ts";
import type { WorktreeFilter } from "./project-tree.ts";
import { type RelayDeps, relayMessage, relayUpdate, syncPeers } from "./relay.ts";
import { parseRequestLink } from "./request-link.ts";
import { RoiSettings } from "./roi-settings.ts";
import { probeAfter, SetupSettings } from "./setup-steps.ts";
import {
  effectiveMode,
  loadChoices,
  type ModeAnswer,
  saveChoice,
  type UiMode,
} from "./simple-mode.ts";
import { TabScopeController } from "./tab-scope.ts";
import { TabOrderController } from "./tab-switcher.ts";
import type { Navigation, Tabs } from "./tabs.ts";
import { isLocalUrl } from "./terminal.ts";
import { TerminalFontController, TerminalReaderSetting } from "./terminal-view.ts";
import { hasFeature } from "./version.ts";

/** The state's types and pure functions live in `app-state.ts`; screens import them from here until each binds its slice (#1596). */
export type {
  Answer,
  AppState,
  AppStoreOptions,
  GateRef,
  HistoryFilter,
  HostView,
  NeedsYouState,
  Notice,
  PendingItem,
  ReleaseNotesResult,
  Selection,
  SidebarSession,
} from "./app-state.ts";
export { HISTORY_PAGE, needsYou } from "./app-state.ts";
export type { HostCommandType, HostResult } from "./kernel.ts";

/** How often the app writes that it is still active (issue #1344). */
const AWAY_MARK_MS = 60_000;

const isRun = (value: unknown): value is WorkflowRun =>
  typeof value === "object" && value !== null && "workflowName" in value && "steps" in value;

const isCard = (value: unknown): value is Card =>
  typeof value === "object" && value !== null && "column" in value && "projectId" in value;

/** Cards inside a command result: a card, a whole board or none. */
function cardsIn(result: unknown): Card[] {
  if (isCard(result)) return [result];
  const columns = (result as { columns?: Array<{ cards: Card[] }> } | undefined)?.columns ?? [];
  return columns.flatMap((column) => column.cards);
}

/** The window kept by the last run; nothing (a fresh window) when it is missing or unreadable. */
function storedWorkspace(storage: Platform["storage"]): unknown {
  try {
    return JSON.parse(storage.getItem(WORKSPACE_KEY) ?? "null");
  } catch {
    return null;
  }
}

export const PALETTE_RECENTS_KEY = "flightdeck.paletteRecents";
/** How many used palette entries are kept (the palette shows five). */
const PALETTE_RECENTS_KEPT = 12;

export { sessionKey };

/** Issue #1478: how long "Not stuck" keeps a quiet session out of Needs you. */
export const QUIET_SNOOZE_MS = 60 * 60 * 1000;

const REAL_TIMERS = {
  setTimeout: (fn: () => void, ms: number): unknown => setTimeout(fn, ms),
  clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Where the window's events (focus, the network) arrive: `window` in a browser or the webview, else the runtime's own global. */
const wakeTarget = (): Partial<Window> =>
  ("window" in globalThis ? globalThis.window : globalThis) as unknown as Partial<Window>;

const newHostView = (config: HostConfig): HostView => ({
  ...config,
  status: "offline",
  info: null,
  hostInfo: null,
  infoAt: 0,
  retry: null,
  incompatibility: null,
  daemonUpdate: null,
  updateCheck: null,
  sessions: [],
});

/** A request whose failure only means less to show (an older daemon, a host without a board). */
const quiet = <T>(promise: Promise<T>) => promise.catch(() => null);

function describeError(error: unknown): string {
  return error instanceof RequestError ? `${error.code}: ${error.message}` : String(error);
}

/**
 * What the setup checklist asks of a host: its hooks, GitHub only when asked, and its projects when
 * they are not read yet. A look from the Setup screen or a host page reads them for the checklist
 * only; the one at connect also opens the list the screens use (see `refreshSetup`).
 */
function setupWants(
  features: readonly string[] | undefined,
  projectsRead: boolean,
  githubAsked: boolean,
) {
  return {
    hooks: hasFeature(features, "central", false),
    github: githubAsked && hasFeature(features, "github", false),
    projects: !projectsRead && hasFeature(features, "workflows", false),
  };
}

/**
 * All app state in one framework-free store: hosts and their connections, session timelines and
 * the current selection. React reads it through `useSyncExternalStore`.
 */
export class AppStore {
  private state: AppState;
  private readonly listeners = new Set<() => void>();
  private readonly connections = new Map<string, HostConnection>();
  /** Sessions followed without being open (the project page's tiles), with how many follow each. */
  private readonly watched = new Map<string, number>();
  /** The tray and the window title that follow the state (phase 8, issue #88, #1596). */
  readonly tray: TraySlice;
  /** Answering a permission request, with the hold a high-risk allow needs (#245, #1596). */
  private readonly permissions: PermissionsSlice;
  private noticeSeq = 0;
  /** What a host's session summaries tell the person, and the teams whose workers it folds (#1596). */
  readonly summaries: SummariesSlice;
  /** What a host tells about the Claude sessions started in a terminal (#1596). */
  readonly external: ExternalSessionsSlice;
  /** What the Sessions screen lists from the online hosts (#1596). */
  private readonly sessionLists: SessionListsSlice;
  /** What a host's session events do to the conversations the app holds (#1596). */
  readonly stream: SessionStreamSlice;
  /** What a person asks of a session: make one, send, interrupt, change mode, close, resume (#1596). */
  private readonly commands: SessionCommandsSlice;
  private readonly historyListeners = new Set<(hostId: string, change: HistoryChanged) => void>();
  /** Who watches each review target's diff (phase 11), by `hostId|target`. */
  private readonly changeListeners = new Map<string, Set<(update: ChangesUpdated) => void>>();
  private offQuit: (() => void) | null = null;
  private readonly openRequestListeners = new Set<(item: PendingItem) => void>();

  private stopWake: (() => void) | null = null;
  /** The history read from every host (#1596): its global search. */
  readonly history: HistorySlice;
  /** What happened on the hosts while the app was away (issue #1344, #1596). */
  readonly activity: ActivitySlice;
  /** The sessions a restart interrupted, and the offer to resume them (issue #150, #1596). */
  readonly sessions: SessionsSlice;
  /** The messages between sessions: the loops a host paused (phase 21, #1596). */
  readonly messaging: MessagingSlice;
  /** The spending limits of each host (phase 8, #1596). */
  readonly budgets: BudgetsSlice;
  /** What each client with a month limit spent against it (phase 9, #1596). */
  readonly clientBudgets: ClientBudgetsSlice;
  /** The personas a session can take on, the hosts' and the app's (phase 20, #1596). */
  readonly personas: PersonasSlice;
  /** The ssh destinos of the hosts, the prompts ssh raises and its terminals (phase 15, #1596). */
  readonly ssh: SshSlice;
  /** What each host's dependencies and doctor say (#1596). */
  readonly health: HealthSlice;
  /** Claude Code's background sessions of each host (phase 27, #1596). */
  readonly background: BackgroundSlice;
  /** The plan quota of each host, its pause guard and the notices it raises (#1596). */
  readonly quota: QuotaSlice;
  /** The Claude account each host is signed in to (phase 34, #1596). */
  readonly account: AccountSlice;
  /** A host's daemon update: asked for, checked, and watched until it comes back (#1596). */
  readonly hostUpdate: HostUpdateSlice;
  readonly settings: SettingsSlice;
  /** The saved commands and prompts, the hosts' and the app's own (phase 18, #1596). */
  readonly snippets: SnippetsSlice;

  /** What every domain's wire file builds its slice's port from (#1596). */
  private readonly kernel: AppKernel<AppState> = {
    state: () => this.state,
    update: (patch) => this.update(patch),
    hostCommand: (hostId, type, payload, options) =>
      this.hostCommand(hostId, type, payload, options),
    hostRequest: (hostId, type, payload) => this.hostRequest(hostId, type, payload),
    dispatch: (hostId, type, payload) => this.dispatch(hostId, type, payload),
    connection: (hostId) => this.connections.get(hostId),
    now: () => this.now(),
    t: () => this.i18n.t,
    onlineHosts: () => this.state.hosts.filter((h) => h.status === "online").map((h) => h.id),
    success: (text) => this.success(text),
    fail: (error, text, retry) => this.fail(error, text, retry),
  };

  constructor(
    private readonly platform: Platform,
    private readonly options: AppStoreOptions = {},
  ) {
    this.history = wireHistory(this.kernel, { searchTimeoutMs: options.searchTimeoutMs });
    this.activity = wireActivity(this.kernel, { since: () => this.awayClock.since() });
    this.sessions = wireSessions(this.kernel, { storage: platform.storage });
    this.personas = wirePersonas(this.kernel, {
      storage: platform.storage,
      language: () => this.i18n.lang,
    });
    this.ssh = wireSsh(this.kernel, {
      hasSecret: (secretId) => this.vault.list().some((secret) => secret.id === secretId),
      secretFor: (hostId, secretId) => this.vaultSecretFor(hostId, secretId, "ssh"),
    });
    this.health = wireHealth(this.kernel);
    this.hostUpdate = wireHostUpdate(this.kernel, {
      patch: (hostId, patch) => this.updateHost(hostId, (h) => ({ ...h, ...patch })),
      open: (hostId) => this.openConnection(hostId),
      describeError,
      timeoutMs: options.daemonUpdateTimeoutMs,
    });
    this.background = wireBackground(this.kernel, {
      showTerminal: (hostId, terminalId) =>
        this.hostTabs.open({ name: "terminal", host: hostId, terminalId }),
    });
    this.quota = wireQuota(this.kernel, {
      notify: (notice, hostId) =>
        this.inbox.notify(notice, { name: "host", host: hostId }, undefined, {
          event: "budget-quota",
          hostId,
        }),
    });
    this.account = wireAccount(this.kernel);
    this.snippets = wireSnippets(this.kernel, { storage: platform.storage });
    this.budgets = wireBudgets(this.kernel, {
      feed: (host, label, percent, limit) => this.webhookFeed.budget(host, label, percent, limit),
      notify: (notification, route, source) =>
        this.inbox.notify(notification, route, undefined, source),
    });
    this.messaging = wireMessaging(this.kernel, {
      notify: (notification) => this.inbox.notify(notification),
    });
    this.settings = wireSettings(this.kernel, {
      platform,
      onShortcut: () => this.history.openSearch(),
    });
    this.hostTabs = HostTabs.restore(
      storedWorkspace(platform.storage),
      undefined,
      options.startRoute,
    );
    this.router = this.hostTabs.router;
    // A navigation took the window to another host's tabs (#932): say so, with the way back.
    this.hostTabs.onSwitch((left, to) => {
      // With no tabs' host yet (after a reload), the switcher named the window's host: the same
      // host is no switch. With no host at all (a first page, a deep link), nothing was left.
      const from = left ?? this.uiHostId();
      if (!from || from === to) return;
      const { t } = this.i18n;
      const name = (id: string) => this.state.hosts.find((host) => host.id === id)?.name ?? id;
      this.success(t("toast.switchedHost", { host: name(to) }), {
        label: t("toast.backTo", { host: name(from) }),
        run: () => this.hostTabs.returnAcross(left),
      });
    });
    // A set kept for a host that is not configured any more (removed before, or gone from the list).
    const configured = new Set(loadHosts(platform.storage).map((host) => host.id));
    for (const id of Object.keys(this.hostTabs.snapshot().hosts)) {
      if (!configured.has(id)) this.hostTabs.removeHost(id);
    }
    this.hostTabs.subscribe(() => {
      platform.storage.setItem(WORKSPACE_KEY, JSON.stringify(this.hostTabs.snapshot()));
      this.clearShownUnread();
    });
    this.vault = new Vault(platform);
    this.vaultApprovals = wireVaultApprovals(this.kernel, {
      vault: this.vault,
      optionsPolicy: () => this.options.vaultPolicy,
      notify: (title, body) => this.inbox.notify({ title, body, event: "needs-you" }),
      recorded: (outcome) => {
        this.usage.recordOutcome(outcome);
        this.keepUsage();
      },
    });
    this.secrets = wireVaultSecrets(this.kernel, {
      vault: this.vault,
      workFactor: () => this.options.vaultWorkFactor,
      saveFile: (name, text) => this.platform.saveFile(name, text),
      pickFile: () => this.platform.vault.pickFile(),
      fail: (error) => this.fail(error),
    });
    this.scan = new VaultScanSlice({ vault: this.vault });
    this.vaultRules = wireVaultRules(this.kernel, {
      rules: new VaultRules(platform.storage),
      secrets: () => this.vault.list(),
      clients: () => this.state.clientList,
      projectKeysOf: (clientId) => this.clientScope.get().projectKeysOf(clientId),
      fail: (error, text) => this.fail(error, text),
      success: (text) => this.success(text),
    });
    this.homeCache = new HomeCache(platform.storage);
    this.whatsNew = new WhatsNew(platform.storage);
    this.clients = new Clients(platform, { onChange: () => this.clientScope.sync() });
    this.clientScope = wireClientScope(this.kernel, {
      storage: platform.storage,
      clients: () => this.clients,
      projects: () =>
        knownProjects([
          ...hubRows(this.state),
          ...Object.entries(this.state.projects).flatMap(([hostId, list]) =>
            list.map((p) => ({
              hostId,
              cwd: p.path,
              projectKey: this.projectList.keyOf(hostId, p),
            })),
          ),
        ]),
      changed: () => {
        this.vaultRules.scopeChanged();
        this.clientBudgets.onLimitsChanged();
      },
    });
    this.clientBudgets = wireClientBudgets(this.kernel, {
      storage: platform.storage,
      limits: () => this.clients.budgets(),
      today: () => this.today(),
      scope: () => this.clientScope.get(),
      clients: () => this.state.clientList,
      feed: (name, clientId, percent, limit) =>
        this.webhookFeed.clientBudget(name, clientId, percent, limit),
      notify: (notification, clientId) =>
        this.inbox.notify(notification, { name: "costs", client: clientId }, undefined, {
          event: "budget-quota",
        }),
    });
    this.roi = new RoiSettings(platform, {
      onChange: () => this.update({ roiRevision: this.state.roiRevision + 1 }),
    });
    this.webhooks = new Webhooks({
      platform,
      send: (request) => this.relayWebhook(request),
      summaryFor: (hostId, claudeSessionId, extra) =>
        this.sessionRecap(hostId, claudeSessionId, extra),
    });
    this.webhookFeed = new WebhookFeed(this.webhooks, (hostId, cwd) => {
      const clientId = cwd ? this.clientScope.get().clientOfFolder(hostId, cwd) : UNASSIGNED;
      return clientId === UNASSIGNED ? null : clientId;
    });
    this.roiFigures = wireRoi(this.kernel, {
      clientOf: (projectKey) => {
        const clientId = this.clientScope.get().clientOf(projectKey);
        return clientId === UNASSIGNED ? null : clientId;
      },
      settings: () => this.roi,
    });
    this.projectList = wireProjects(this.kernel);
    this.prWatch = wireWatch(this.kernel, {
      feed: (host, title, before, watch) => this.webhookFeed.watch(host, title, before, watch),
      notify: (notification, route, fallbackUrl, source) =>
        this.inbox.notify(notification, route, fallbackUrl, source),
    });
    this.usage = new VaultUsageLog(platform);
    this.theme = new ThemeController(platform);
    this.assistant = new AssistantController({
      storage: platform.storage,
      api: platform.assistant,
      hosts: () =>
        this.state.hosts.map((host) => ({
          id: host.id,
          name: host.name,
          online: host.status === "online",
          assistant: hasFeature(host.hostInfo?.features, "assistant", false),
        })),
      secrets: () => this.state.secrets.map((secret) => ({ id: secret.id, name: secret.name })),
      language: () => this.i18n.lang,
      request: (hostId, type, payload) =>
        this.hostRequest(hostId, type as HostCommandType, payload as never) as Promise<HostAnswer>,
    });
    this.density = new DensityController(platform.storage);
    this.terminalFont = new TerminalFontController(platform.storage);
    this.terminalReader = new TerminalReaderSetting(platform.storage);
    this.setup = new SetupSettings(platform.storage);
    this.cacheTimer = new CacheTimerSettings(platform.storage);
    this.clock = new SharedClock(
      browserClockDeps(() => this.now(), typeof document === "undefined" ? undefined : document),
    );
    this.tabOrder = new TabOrderController(platform.storage);
    this.tabScope = new TabScopeController(platform.storage);
    this.sidebarFold = new SidebarFoldController(platform.storage);
    this.dataScope = new DataScopeController(platform.storage);
    this.shellPrefs = new ShellPrefs(platform.storage);
    this.newSessionPrefs = new NewSessionPrefs(platform.storage);
    this.boardWidth = new BoardWidth(platform.storage);
    this.notifyPrefs = new NotifyPreferences(platform.storage);
    this.appUpdates = wireAppUpdates(this.kernel, {
      updater: () => this.platform.updater,
      intervalMs: () => this.options.appUpdateIntervalMs,
      log: (level, source, message) => this.appLog.log(level, source, message),
      quitNow: () => this.platform.quitNow(),
    });
    this.terminals = wireTerminals(this.kernel, {
      showTab: (hostId, terminalId) =>
        this.hostTabs.open({ name: "terminal", host: hostId, terminalId }),
      closingTab: (closing) => {
        // The area is the current host's, or another host's first one (a tab of the all-hosts row).
        const area = [...this.workspace.areas, ...this.hostTabs.groups().map((g) => g.tabs)].find(
          (candidate) => candidate.id === closing.areaId,
        );
        const route = area?.tabs.find((tab) => tab.id === closing.tabId)?.router.current;
        if (!area || route?.name !== "terminal") return null;
        return {
          hostId: route.host,
          terminalId: route.terminalId,
          closeTab: () => area.close(closing.tabId),
        };
      },
      copyText: (text) => this.copyText(text),
      spawn: (program, args) => this.platform.terminal.open(program, args),
      describeError,
    });
    this.viewPrefs = new ViewPrefsSlice({ storage: platform.storage });
    this.roster = new HostRosterSlice({
      secrets: platform.secrets,
      hosts: () => this.state.hosts,
      list: (config) => this.update({ hosts: [...this.state.hosts, newHostView(config)] }),
      persist: () => this.persistHosts(),
      connect: (config, token) => this.connect(config, token),
      stop: (hostId) => this.connections.get(hostId)?.dispose(),
      detach: (hostId) => {
        this.hostTabs.removeHost(hostId);
        this.connections.get(hostId)?.dispose();
        this.connections.delete(hostId);
      },
      forget: (hostId) => {
        const ofOthers = <T>(all: Record<string, T>) =>
          Object.fromEntries(Object.entries(all).filter(([key]) => !key.startsWith(`${hostId}/`)));
        const { [hostId]: _gone, ...setupProbes } = this.state.setupProbes;
        this.update({
          hosts: this.state.hosts.filter((h) => h.id !== hostId),
          sessions: ofOthers(this.state.sessions),
          cards: ofOthers(this.state.cards),
          selected: this.state.selected?.hostId === hostId ? null : this.state.selected,
          setupProbes,
        });
        this.hostUpdate.forget(hostId);
      },
      setName: (hostId, name) => this.updateHost(hostId, (h) => ({ ...h, name })),
      rememberToken: (token) => this.scan.rememberToken(token),
      t: () => this.i18n.t,
    });
    this.inbox = wireInbox(this.kernel, {
      storage: platform.storage,
      prefs: () => this.notifyPrefs.value,
      soundFile: () => this.notifyPrefs.soundFile(),
      waiting: () => needsYou(this.state).map((i) => `${i.hostId}/${i.requestId}`),
      show: (notification) => this.platform.notify(notification),
      setBadge: (count) => this.platform.setBadge?.(count),
    });
    this.i18n = new I18n(platform);
    this.backupScheduler = new BackupScheduler(platform, {
      onAttention: (kind) => this.onBackupAttention(kind),
      google: options.google ?? { config: googleConfig() },
      ...(options.vaultWorkFactor !== undefined && { workFactor: options.vaultWorkFactor }),
    });
    this.backup = new BackupSlice({
      createText: async (passphrase, confirmation) => {
        const { createBackup } = await import("./backup-bundle.ts");
        return createBackup(platform, passphrase, confirmation, {
          ...(options.vaultWorkFactor !== undefined && { workFactor: options.vaultWorkFactor }),
        });
      },
      saveFile: (name, text) => platform.saveFile(name, text),
      pickFile: () => platform.vault.pickFile(),
      previewText: async (text, passphrase) => {
        const { previewRestore } = await import("./backup-bundle.ts");
        return previewRestore(platform, text, passphrase);
      },
      applyPreview: async (preview, onConflict) => {
        const { applyRestore } = await import("./backup-bundle.ts");
        return applyRestore(platform, preview, onConflict);
      },
      driveNames: () => this.backupScheduler.driveBackups(),
      driveText: (name) => this.backupScheduler.driveBackupText(name),
      fail: (error) => this.fail(error),
    });
    this.awayClock = new AwayClock(platform.storage, () => this.now());
    this.appLog = new AppLog({ sink: platform.logs, values: () => this.scan.values() });
    this.commands = wireSessionCommands(this.kernel, {
      opened: (hostId, sessionId) => {
        this.select(hostId, sessionId);
        // A new session opens, wherever it was created from (phase 10).
        this.history.closeSearch();
        this.router.push({ name: "session", host: hostId, id: sessionId });
      },
    });
    this.permissions = new PermissionsSlice({
      needsYou: () => needsYou(this.state, this.i18n.t),
      sessions: () => this.state.sessions,
      selectedHostId: () => this.state.selected?.hostId,
      settleVault: (requestId, answer) => this.vaultApprovals.settle(requestId, answer),
      sendOn: (hostId, response) =>
        this.connections.get(hostId)?.request("permission.respond", response),
      sendSelected: (response) =>
        this.commands.onSelected((conn) => conn.request("permission.respond", response)),
      fail: (error, text) => this.fail(error, text),
      t: () => this.i18n.t,
    });
    this.external = wireExternalSessions(this.kernel, {
      projectOf: (hostId, cwd) => this.sessionProject(hostId, cwd),
      isFocused: () => this.platform.isFocused(),
      notify: (...args) => this.inbox.notify(...args),
      feedSession: (host, prev, next) => this.webhookFeed.externalSession(host, prev, next),
      feedPermission: (host, frame, cwd) => this.webhookFeed.externalPermission(host, frame, cwd),
    });
    this.sessionLists = wireSessionLists(this.kernel, {
      backgroundPatch: (hostId, list) => this.background.changed(hostId, list),
    });
    this.stream = wireSessionStream(this.kernel, {
      summary: (hostId, event) => this.summaries.apply(hostId, [event]),
    });
    this.summaries = wireSummaries(this.kernel, {
      setSessions: (hostId, sessions) => this.updateHost(hostId, (h) => ({ ...h, sessions })),
      shown: () => this.shownSessions(),
      projectOf: (hostId, cwd) => this.sessionProject(hostId, cwd),
      isSimple: (hostId) => this.uiMode(hostId).mode === "simple",
      isFocused: () => this.platform.isFocused(),
      prefs: () => this.notifyPrefs.value,
      notify: (...args) => this.inbox.notify(...args),
      feed: (host, prev, next) => this.webhookFeed.managed(host, prev, next),
      finished: (hostId, prev, next) => this.recordFinished(hostId, prev, next),
      later: (fn, ms) => void this.later(fn, ms),
    });
    this.tray = wireTray(this.kernel, {
      platform,
      needsYou: () => needsYou(this.state, this.i18n.t),
      uiHostId: () => this.uiHostId(),
      isSimple: (hostId) => this.uiMode(hostId).mode === "simple",
      answer: (hostId, requestId, decision) => void this.respondTo(hostId, requestId, decision),
      open: (item) => this.openRequest(item),
      timers: options.timers ?? REAL_TIMERS,
    });
    this.i18n.subscribe(() => this.onLanguage());
    this.state = {
      hosts: [],
      sessions: {},
      selected: null,
      error: null,
      ...initialHistoryState,
      closingTerminal: null,
      runEnvs: {},
      unread: {},
      cards: {},
      runs: {},
      ...initialQuotaState(),
      ...initialAccountState(),
      ...initialHealthState(),
      setupProbes: {},
      ...initialSnippetsState(),
      ...initialBackgroundState(),
      ...initialMessagingState(),
      ...initialBudgetsState(),
      ...initialClientBudgetsState(),
      ...initialPersonasState(),
      ...initialSshState(),
      quietSnooze: loadQuietSnooze(platform.storage, (options.now ?? Date.now)()),
      watches: {},
      names: {},
      secrets: new Vault(platform).list(),
      vaultUsage: this.usage.list(),
      vaultApprovals: [],
      externals: {},
      externalRequests: {},
      meta: {},
      uiChoices: loadChoices(platform.storage),
      ...initialSessionsState(),
      hub: {},
      terminalEnv: null,
      projects: {},
      clientList: this.clients.list(),
      roiRevision: 0,
      worktreeFilter: null,
      clientOverrides: this.clients.overrides(),
      clientSelection: loadSelection(platform.storage, this.clients.list()),
      notices: [],
      ...initialActivityState(),
      inbox: [],
      composerFill: {},
      finished: [],
      finishedLook: null,
      hostsLoaded: false,
      appUpdate: initialAppUpdateState(),
      ...initialSettingsState(platform),
    };
  }

  /** Light, dark or the system's (phase 10). */
  readonly theme: ThemeController;
  /** Phase 40: the AI assistant's preferences, keys state and the wand's requests. */
  readonly assistant: AssistantController;
  /** Where a wand with no provider sends the person: Settings, section Assistant (issue #162). */
  readonly openAssistantSettings = (): void =>
    this.router.push({ name: "settings", section: "assistant" });
  readonly density: DensityController;
  readonly terminalFont: TerminalFontController;
  /** Issue #107: the view each session tab was on, and the page now on screen. */
  readonly sessionViews = new SessionViews();
  readonly terminalReader: TerminalReaderSetting;
  /** The setup checklist: hidden or not, and whether a test notification ever showed. */
  readonly setup: SetupSettings;
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
  /** The project keys any screen has read, for one label per project everywhere (issue #881). */
  readonly projectKeys = new ProjectKeys();
  /** What the shell hides: the New and Beta badges, What's new (issue #282). */
  readonly shellPrefs: ShellPrefs;
  /** What the New session form starts from: the last mode, model and folder (issue #1135). */
  readonly newSessionPrefs: NewSessionPrefs;
  /** The board columns' width, one for all, kept across starts (issue #161). */
  readonly boardWidth: BoardWidth;
  /** What the person chose about notifications: events, mutes, team folding, sound (issue #149). */
  readonly notifyPrefs: NotifyPreferences;
  /** The notification center (the bell), the taskbar badge, the OS toast and the sound (#1596). */
  readonly inbox: InboxSlice;
  /** The app's own update: the check, the background download, the install and the one on quit (#1596). */
  readonly appUpdates: AppUpdateSlice;
  /** Which hosts the app has: adding, removing, naming, pairing again and reconnecting (#1596). */
  readonly roster: HostRosterSlice;
  /** The terminals of every host: their commands, tabs, "Claude aqui" and the close that asks (#1596). */
  readonly terminals: TerminalsSlice;
  /** How the person left the windows: widths, folds, hub view and filter, tile layout (#1596). */
  readonly viewPrefs: ViewPrefsSlice;
  /** pt-BR or English, and the translator (phase 10). */
  readonly i18n: I18n;
  /** Issue #1264: scheduled backups to a picked folder (the desktop app only). */
  readonly backupScheduler: BackupScheduler;
  /** The whole-app backup file: save, read, compare and restore (#1596). */
  readonly backup: BackupSlice;
  /** Issue #1344: when the app was last active, read before this start writes its own. */
  private readonly awayClock: AwayClock;
  private awayTimer: ReturnType<typeof setInterval> | null = null;
  /** The app's log: what happens to hosts, refusals and updates goes through it (issue #255). */
  readonly appLog: AppLog;
  /** The screen in use and its history (phase 10). */
  readonly router: Navigation;
  /** Each host's own tabs and the shared screens (issue #644). */
  readonly hostTabs: HostTabs;
  /** What the window shows while there is no host and no shared tab: never kept. */
  private readonly noHost = new Workspace({ name: "start" });

  /** The current host's window (its tabs and split); an empty one with no host. */
  get workspace(): Workspace {
    return this.hostTabs.workspace ?? this.noHost;
  }

  /** The tabs in use: the shared ones while a shared tab is active or with no host, else the host's focused area. */
  get tabs(): Tabs {
    return this.hostTabs.onShared || !this.hostTabs.workspace
      ? this.hostTabs.shared
      : this.workspace.tabs;
  }

  getState = (): AppState => this.state;

  /** Milliseconds now (injected in tests). */
  now(): number {
    return (this.options.now ?? Date.now)();
  }

  /** Today as `YYYY-MM-DD`, in this machine's time zone unless injected. */
  today(): string {
    return (this.options.day ?? localDay)(this.now());
  }

  /** HH:MM of an instant, in this machine's time zone unless injected. */
  formatTime(iso: string): string {
    if (this.options.formatTime) return this.options.formatTime(iso);
    return formatTime(iso, this.i18n.lang, this.options.timeZone);
  }

  /** Date and time of an instant in local time, in the app's language (phase 10). */
  formatDateTime(iso: string): string {
    return Number.isNaN(Date.parse(iso))
      ? ""
      : formatDateTime(iso, this.i18n.lang, this.options.timeZone);
  }

  /** A list's short time: HH:MM today, the day and month before (phase 10). */
  formatWhen(iso: string): string {
    return Number.isNaN(Date.parse(iso))
      ? ""
      : formatWhen(iso, this.now(), this.i18n.lang, this.options.timeZone);
  }

  /** The round trip of each host's last heartbeat, apart from the state: a ping renders no screen. */
  private readonly latencies = new Map<string, number | null>();
  private readonly latencyListeners = new Set<() => void>();

  getLatency = (hostId: string): number | null => this.latencies.get(hostId) ?? null;

  /** For the one component that shows a latency; a heartbeat never reaches `subscribe`. */
  subscribeLatency = (listener: () => void): (() => void) => {
    this.latencyListeners.add(listener);
    return () => this.latencyListeners.delete(listener);
  };

  private setLatency(hostId: string, latencyMs: number | null): void {
    if (this.getLatency(hostId) === latencyMs) return;
    this.latencies.set(hostId, latencyMs);
    for (const listener of [...this.latencyListeners]) listener(); // NOSONAR: a listener may subscribe or unsubscribe while it runs: this pass goes over a copy
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async init(): Promise<void> {
    this.inbox.load();
    const kept = loadFinished(this.platform.storage);
    this.update({ finished: kept.list, finishedLook: kept.lastLook });
    this.inbox.syncBadge();
    // Reset synchronously first: nothing from a previous init may stay visible while awaiting.
    this.dispose();
    this.listenForWake();
    this.theme.start();
    void this.assistant.refreshKeys();
    this.i18n.start();
    this.update({
      hosts: [],
      hostsLoaded: false,
      sessions: {},
      selected: null,
      cards: {},
      runs: {},
      ...initialQuotaState(),
      ...initialAccountState(),
      ...initialHealthState(),
    });
    await this.settings.load();
    // Client budgets are looked at every few minutes, and when a host with costs comes online.
    this.clientBudgets.start(this.options.clientBudgetIntervalMs);
    this.appUpdates.start();
    // Issue #1344: the time the app is active, for the next start's "While you were away".
    this.awayClock.mark();
    if (this.awayTimer) clearInterval(this.awayTimer);
    this.awayTimer = setInterval(() => this.awayClock.mark(), AWAY_MARK_MS);
    // A schedule that cannot start (storage full) must not stop the app from starting.
    this.backupScheduler.start().catch(() => {});
    await this.settings.registerSaved();
    this.tray.start();
    this.offQuit?.();
    this.offQuit = this.platform.onQuitRequested(() => void this.appUpdates.quit());
    await inSequence(loadHosts(this.platform.storage), async (config) => {
      // A host added while init ran (#1718) is already listed and connecting.
      if (this.state.hosts.some((host) => host.id === config.id)) return;
      this.update({ hosts: [...this.state.hosts, newHostView(config)] });
      const token = await this.platform.secrets.get(config.id);
      if (token) this.connect(config, token);
    });
    this.update({ hostsLoaded: true });
    // #126 slice 2: the hub's own host filter (a name) becomes the data scope once, unless one
    // was chosen already; either way it leaves the hub, which now follows the scope.
    const hubHost = takeHubHost(this.platform.storage);
    if (hubHost && !this.dataScope.chosen) {
      this.dataScope.set(hubHostScope(hubHost, this.state.hosts));
    }
    // Last: the saved hosts must not wait for it.
    if (this.platform.terminal.supported) {
      this.update({ terminalEnv: await this.platform.terminal.probe() });
    }
  }

  /** Adds a host and connects; the roster does the work (kept here: most screens' tests start from it). */
  addHost(input: NewHost): Promise<string> {
    return this.roster.add(input);
  }

  /** Starts the poll the GitHub panel runs while a sign-in waits; the returned function stops it. */
  githubTicker(tick: () => void): () => void {
    if (this.options.githubTicker) return this.options.githubTicker(tick);
    const timer = setInterval(tick, 1500);
    return () => clearInterval(timer);
  }

  /** "Abrir" on a request outside the window (tray, notification): the app shows it. */
  onOpenRequest(listener: (item: PendingItem) => void): () => void {
    this.openRequestListeners.add(listener);
    return () => this.openRequestListeners.delete(listener);
  }

  /**
   * A `flightdeck://request` link (a notification click): brings the window up on the request.
   * False for any other link, which the caller handles (pairing).
   */
  openRequestLink(url: string): boolean {
    const link = parseRequestLink(url);
    if (!link) return false;
    const item = needsYou(this.state, this.i18n.t).find(
      (i) => i.hostId === link.hostId && i.requestId === link.requestId,
    );
    // Already answered: the window still comes up.
    if (item) this.openRequest(item);
    else void this.platform.showMainWindow();
    return true;
  }

  /**
   * Approves or denies the oldest waiting request; a high-risk one is opened, as in the tray.
   * `shown` is the `host/request` the command named: when that one has gone in between, the one
   * now oldest is opened to be seen, never answered unseen (#245).
   */
  decideOldest(decision: "approve" | "deny", shown: string): void {
    const item = needsYou(this.state, this.i18n.t)[0];
    if (!item) return;
    if (`${item.hostId}/${item.requestId}` !== shown) {
      this.openRequest(item);
      return;
    }
    // A gate or a vault request is opened to be seen, never answered blind (issue #187); the
    // palette is not the tray, so a vault grant is never logged as the tray's.
    if (item.gate || item.vault) this.openRequest(item);
    else this.tray.act({ key: `${item.hostId}/${item.requestId}`, action: decision });
  }

  /** What the palette was used for lately, most recent first. */
  paletteRecents(): string[] {
    try {
      const stored = JSON.parse(this.platform.storage.getItem(PALETTE_RECENTS_KEY) ?? "[]");
      return Array.isArray(stored)
        ? stored.filter((id): id is string => typeof id === "string")
        : [];
    } catch {
      return [];
    }
  }

  /** Remembers that a palette entry was used: first in the list, each id once, a few kept. */
  recordPaletteUse(id: string): void {
    const next = [id, ...this.paletteRecents().filter((other) => other !== id)].slice(
      0,
      PALETTE_RECENTS_KEPT,
    );
    this.platform.storage.setItem(PALETTE_RECENTS_KEY, JSON.stringify(next));
  }

  private openRequest(item: PendingItem): void {
    void this.platform.showMainWindow();
    for (const listener of this.openRequestListeners) listener(item);
  }

  /** Hands `text` to the message box of the session `key`; it waits there until the box takes it. */
  fillComposer(key: string, text: string): void {
    const waiting = this.state.composerFill[key];
    this.update({
      composerFill: { ...this.state.composerFill, [key]: waiting ? `${waiting}\n\n${text}` : text },
    });
  }

  /** The text waiting for the session's box, which is now taken; `null` when there is none. */
  takeComposerFill(key: string): string | null {
    const { [key]: text, ...rest } = this.state.composerFill;
    if (text === undefined) return null;
    this.update({ composerFill: rest });
    return text;
  }

  /** The person looked at Needs you: what finished before now is no longer new. */
  finishedSeen(): void {
    this.setFinished(this.state.finished, new Date(this.now()).toISOString());
  }

  private setFinished(list: Finish[], lastLook: string | null): void {
    this.update({ finished: list, finishedLook: lastLook });
    saveFinished(this.platform.storage, { list, lastLook });
  }

  /** A turn, a failure or an end is a finish for Needs you, unless the person watched it happen. */
  private recordFinished(
    hostId: string,
    prev: SidebarSession | undefined,
    next: SidebarSession,
  ): void {
    const outcome = finishOutcome(prev?.status, next.status);
    if (!outcome) return;
    const key = sessionKey(hostId, next.id);
    if (this.platform.isFocused() && this.shownSessions().has(key)) return;
    const at = new Date(this.now()).toISOString();
    const finish: Finish = {
      key,
      hostId,
      sessionId: next.id,
      name: next.name ?? basename(next.cwd),
      outcome,
      at,
      files: null,
    };
    this.setFinished(recordFinish(this.state.finished, finish), this.state.finishedLook);
    void this.countFinishedFiles(hostId, next.id, key, at);
  }

  /** Asks the host how many files the session changed; a host that cannot say leaves it unknown. */
  private async countFinishedFiles(
    hostId: string,
    sessionId: string,
    key: string,
    at: string,
  ): Promise<void> {
    // The host reads `session:<id>` as the Claude session id, which the app learns with the session.
    const claudeId =
      this.state.sessions[key]?.claudeSessionId ??
      this.state.hub[hostId]?.managed.find((s) => s.id === sessionId)?.claudeSessionId;
    if (!claudeId) return;
    const result = await this.hostRequest(hostId, "changes.get", {
      target: `session:${claudeId}`,
    });
    if (!result.ok) return;
    const files = result.data.files.length;
    this.setFinished(withFiles(this.state.finished, key, at, files), this.state.finishedLook);
  }

  /** Issue #1327: a scheduled backup that cannot go reaches the bell, and a click opens its settings. */
  private onBackupAttention(kind: Attention): void {
    const t = this.i18n.t;
    this.inbox.notify(
      {
        title: t(`backupSchedule.attention.${kind}.title`),
        body: t(`backupSchedule.attention.${kind}.body`),
      },
      { name: "settings", section: "backup" },
    );
  }

  /** The app's latest releases, read through the first online host that offers them (issue #125). */
  async releaseNotes(): Promise<ReleaseNotesResult> {
    const host = this.state.hosts.find(
      (h) => h.status === "online" && hasFeature(h.hostInfo?.features, "releases", false),
    );
    if (!host) return { kind: "none" };
    const result = await this.hostRequest(host.id, "releases.list", { limit: 8 });
    if (result.ok) return { kind: "ready", releases: result.data.releases };
    return {
      kind: "error",
      message: refusalText(result.code, result.message, this.i18n.t, result),
    };
  }

  /** Opens a web page (an issue, a PR) in the user's browser; anything but http(s) is refused. */
  openLink(url: string): void {
    if (/^https?:\/\//i.test(url)) void this.platform.openExternal(url);
  }

  /** `flightdeck://` links opened from outside the app (OS deep link or second instance). */
  onDeepLink(handler: (url: string) => void): () => void {
    return this.platform.onDeepLink(handler);
  }

  /** Selects a session: only the open one keeps a subscription to its full event stream. */
  select(hostId: string, sessionId: string | null): void {
    const previous = this.state.selected;
    if (
      previous?.sessionId &&
      previous.sessionId !== sessionId &&
      !this.watched.has(`${previous.hostId}/${previous.sessionId}`)
    ) {
      this.connections.get(previous.hostId)?.unsubscribe(previous.sessionId);
    }
    if (sessionId) this.connections.get(hostId)?.subscribe(sessionId);
    this.update({ selected: { hostId, sessionId } });
  }

  /**
   * Follows a session's full event stream without opening it, for as long as the returned function
   * has not been called (the tiles of a project follow several at once).
   */
  watchSession(hostId: string, sessionId: string): () => void {
    const key = `${hostId}/${sessionId}`;
    this.watched.set(key, (this.watched.get(key) ?? 0) + 1);
    this.connections.get(hostId)?.subscribe(sessionId);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = (this.watched.get(key) ?? 1) - 1;
      if (left > 0) {
        this.watched.set(key, left);
        return;
      }
      this.watched.delete(key);
      const open = this.state.selected;
      if (open?.hostId === hostId && open.sessionId === sessionId) return;
      this.connections.get(hostId)?.unsubscribe(sessionId);
    };
  }

  /** Puts an idle session to sleep now and says, in a toast, what came of it. */
  async sleepSession(hostId: string, sessionId: string): Promise<void> {
    const answer = await this.hostCommand(hostId, "session.sleep", { sessionId });
    if (answer) this.success(this.i18n.t(`sleep.result.${answer.result}` as Key));
  }

  /** Whether a file of the host can be opened here: the app can, and the host runs on this machine. */
  canOpenPaths(hostId: string): boolean {
    const host = this.state.hosts.find((h) => h.id === hostId);
    return this.platform.openPath !== undefined && host !== undefined && isLocalUrl(host.url);
  }

  /** Opens a file the host made with the system's default app; false when it cannot. */
  async openPath(hostId: string, path: string): Promise<boolean> {
    return this.onLocalPath(hostId, path, (p) => this.platform.openPath?.(p));
  }

  /** Shows a file the host made in the system's file manager; false when it cannot. */
  async revealPath(hostId: string, path: string): Promise<boolean> {
    return this.onLocalPath(hostId, path, (p) => this.platform.revealPath?.(p));
  }

  private async onLocalPath(
    hostId: string,
    path: string,
    act: (path: string) => Promise<void> | undefined,
  ): Promise<boolean> {
    // Only a host of this machine has files that are here, and only a full path says which.
    if (
      !this.canOpenPaths(hostId) ||
      !/^([A-Za-z]:[\\/]|\/(?![\\/]))/.test(path) ||
      path.includes("..")
    ) {
      return false;
    }
    try {
      await act(path);
      return true;
    } catch (error) {
      this.fail(error);
      return false;
    }
  }

  /** The mode a host opens in: the person's choice, else the host's default, else full (phase 33). */
  uiMode(hostId: string): ModeAnswer {
    const host = this.state.hosts.find((h) => h.id === hostId);
    return effectiveMode(this.state.uiChoices[hostId], host?.hostInfo?.ui);
  }

  /** The host the switcher shows: the active tab's, or the last one used on a shared tab. */
  activeHostId(): string | null {
    return this.hostTabs.hostId;
  }

  /** A new tab: the Overview of a host; with no host at all, the one Home tab is brought forward. */
  openNewTab(): void {
    const { hosts } = this.state;
    const host =
      this.hostTabs.hostId ?? hosts.find((h) => h.status === "online")?.id ?? hosts[0]?.id ?? null;
    if (host) this.hostTabs.open({ name: "host", host });
    else this.hostTabs.show({ name: "home" });
  }

  /** The host whose mode the window shows: the selected one, else the first that is online. */
  uiHostId(): string | null {
    const { hosts, selected } = this.state;
    return (
      hosts.find((h) => h.id === selected?.hostId)?.id ??
      hosts.find((h) => h.status === "online")?.id ??
      null
    );
  }

  /** Switches the window between simple and full mode; false when the host is locked or none shows. */
  toggleUiMode(): boolean {
    const hostId = this.uiHostId();
    if (!hostId) return false;
    const now = this.uiMode(hostId);
    if (!now.canSwitch) return false;
    this.setUiChoice(hostId, now.mode === "simple" ? "full" : "simple");
    return true;
  }

  /** The person's choice for a host; `null` forgets it, so the host's default speaks again. */
  setUiChoice(hostId: string, mode: UiMode | null): void {
    saveChoice(this.platform.storage, hostId, mode);
    this.update({ uiChoices: loadChoices(this.platform.storage) });
  }

  /** Changes the host's default mode and lock (full mode's Settings of that host). */
  async setHostUi(hostId: string, patch: { mode?: UiMode; locked?: boolean }): Promise<boolean> {
    const ui = await this.hostCommand(hostId, "ui.set", { ...patch, confirm: true });
    if (!ui) return false;
    this.updateHost(hostId, (h) => (h.hostInfo ? { ...h, hostInfo: { ...h.hostInfo, ui } } : h));
    return true;
  }

  /** Sends a message to a session of a host, whether it is the open one or not. */
  async sendTo(
    hostId: string,
    sessionId: string,
    text: string,
    images?: SessionImage[],
  ): Promise<void> {
    const conn = this.connections.get(hostId);
    if (!conn) return;
    try {
      await conn.request("session.send", {
        sessionId,
        text,
        ...(images?.length ? { images } : {}),
      });
    } catch (error) {
      this.fail(error);
    }
  }

  /** Picks the checkout the board and the Sessions list narrow to, or clears it. */
  setWorktreeFilter(filter: WorktreeFilter | null): void {
    this.update({ worktreeFilter: filter });
  }

  /**
   * What the palette lists besides live state: the Sessões lists, each host's projects and their
   * cards. Quiet: a host without a board (or offline) just lists less.
   */
  /** #1220: one project's board on a host, its cards into the state (a host that fails says nothing). */
  async loadBoard(hostId: string, projectId: string): Promise<void> {
    const conn = this.connections.get(hostId);
    if (!conn) return;
    const board = await quiet(conn.request("board.get", { projectId }));
    for (const card of cardsIn(board)) this.onCard(hostId, card);
  }

  async loadPalette(): Promise<void> {
    const boards = this.state.hosts
      .filter((host) => host.status === "online")
      .map(async (host) => {
        const projects = await this.projectList.load(host.id);
        await inSequence(projects ?? [], (project) => this.loadBoard(host.id, project.id));
      });
    const targets = this.state.hosts
      .filter(
        (host) => host.status === "online" && hasFeature(host.hostInfo?.features, "ssh", false),
      )
      .map(async (host) => {
        await this.ssh.loadTargets(host.id);
      });
    const personas = this.state.hosts
      .filter(
        (host) =>
          host.status === "online" && hasFeature(host.hostInfo?.features, "personas", false),
      )
      .map((host) => this.personas.load(host.id));
    const snippets = this.state.hosts
      .filter(
        (host) =>
          host.status === "online" && hasFeature(host.hostInfo?.features, "snippets", false),
      )
      .map(async (host) => {
        const listed = await quiet(this.dispatch(host.id, "snippets.list", {}));
        if (listed) this.snippets.keep(host.id, listed.snippets);
      });
    await Promise.all([this.refreshHub(), ...boards, ...targets, ...snippets, ...personas]);
  }

  /** The run.yaml of a project on its base branch, with its validation and trust. */
  runEnvConfig(hostId: string, projectId: string): Promise<RunConfigInfo | null> {
    return this.hostCommand(hostId, "runenv.config", { projectId });
  }

  /** Trusts the run.yaml the user reviewed. */
  runTrust(hostId: string, projectId: string, hash: string): Promise<RunConfigInfo | null> {
    return this.hostCommand(hostId, "runenv.trust", { projectId, hash });
  }

  /** Run: the card's setup (once) and processes. A refusal goes to the banner. */
  async runStart(hostId: string, cardId: string): Promise<void> {
    const state = await this.hostCommand(hostId, "runenv.start", { cardId });
    if (state) this.onRunEnv(hostId, state);
  }

  /** Stop: ends the card's processes and everything they started. */
  async runStop(hostId: string, cardId: string): Promise<void> {
    const state = await this.hostCommand(hostId, "runenv.stop", { cardId });
    if (state) this.onRunEnv(hostId, state);
  }

  private onRunEnv(hostId: string, state: RunState): void {
    this.update({ runEnvs: { ...this.state.runEnvs, [sessionKey(hostId, state.cardId)]: state } });
  }

  /** Closes a tab; a terminal's waits in `closingTerminal` for detach or end. */
  closeTab(area: Tabs, tabId: string): void {
    const tab = area.tabs.find((candidate) => candidate.id === tabId);
    const route = tab?.router.current;
    if (route?.name === "terminal") {
      this.update({ closingTerminal: { areaId: area.id, tabId } });
      return;
    }
    // Issue #107: the shell a session page opened lives as long as its tab.
    if (route?.name === "session") {
      const key = sessionKey(route.host, route.id);
      const terminalId = this.sessionViews.terminalOf(key);
      if (terminalId) {
        this.sessionViews.setTerminal(key, null);
        void this.hostCommand(route.host, "terminal.close", { terminalId, kill: true });
      }
    }
    area.close(tabId);
  }

  /** A host's indexed sessions; errors go to the banner and give `null`. */
  async historyList(hostId: string, filter: HistoryFilter): Promise<HistoryListResult | null> {
    try {
      const conn = this.connections.get(hostId);
      if (!conn) throw new RequestError("offline", "unknown host");
      return await conn.request("history.list", { ...filter, limit: HISTORY_LIST_LIMIT });
    } catch (error) {
      this.fail(error);
      return null;
    }
  }

  /** One page of a host's transcript; errors go to the banner and give `null`. */
  async historyGet(
    hostId: string,
    claudeSessionId: string,
    cursor?: string,
    tail = false,
    /** Told why a read was refused (issue #227): the reader tells "not found" from a failure. */
    refused?: (reason: string | undefined) => void,
  ): Promise<HistoryGetResult | null> {
    try {
      const conn = this.connections.get(hostId);
      if (!conn) throw new RequestError("offline", "unknown host");
      return await conn.request("history.get", {
        claudeSessionId,
        limit: HISTORY_PAGE,
        ...(cursor ? { cursor } : {}),
        ...(tail && !cursor ? { tail: true } : {}),
      });
    } catch (error) {
      refused?.(error instanceof RequestError ? error.reason : undefined);
      // Not indexed yet is a normal state (the indexer catches up), not something to tell the person.
      if (!(error instanceof RequestError && error.reason === "transcript_not_indexed")) {
        this.fail(error);
      }
      return null;
    }
  }

  /**
   * Continues an indexed transcript as a managed session and opens it. `force` is only sent after
   * the user confirmed a possibly-in-use session.
   */
  async resumeHistory(
    hostId: string,
    claudeSessionId: string,
    force: boolean,
  ): Promise<string | null> {
    try {
      const conn = this.connections.get(hostId);
      if (!conn) throw new RequestError("offline", "unknown host");
      const { sessionId } = await conn.request("history.resume", {
        claudeSessionId,
        ...(force ? { force: true } : {}),
      });
      this.select(hostId, sessionId);
      return sessionId;
    } catch (error) {
      this.fail(error);
      return null;
    }
  }

  /**
   * Sends a project, board or card command to a host. Cards in the answer go to `cards`; errors
   * go to the banner and give `null`.
   */
  async hostCommand<T extends HostCommandType>(
    hostId: string,
    type: T,
    payload: CommandPayload<T>,
    options: HostCommandOptions = {},
  ): Promise<CommandResults[T] | null> {
    try {
      return await this.dispatch(hostId, type, payload);
    } catch (error) {
      this.fail(
        error,
        undefined,
        options.retry === false
          ? undefined
          : () =>
              void this.hostCommand(hostId, type, payload, {
                focusRefusal: options.focusRefusal === true,
              }),
        options.focusRefusal === true,
      );
      return null;
    }
  }

  /**
   * Like `hostCommand`, but a refusal comes back with its code and message instead of going to
   * the banner: for screens that explain it themselves (a file that changed, a merge conflict).
   */
  async hostRequest<T extends HostCommandType>(
    hostId: string,
    type: T,
    payload: CommandPayload<T>,
  ): Promise<HostResult<CommandResults[T]>> {
    try {
      return { ok: true, data: await this.dispatch(hostId, type, payload) };
    } catch (error) {
      // A connection only ever rejects with a RequestError (even a host it does not know).
      const { code, message, reason, params, items } = error as RequestError;
      return {
        ok: false,
        code,
        message,
        ...(reason ? { reason, params: params ?? {} } : {}),
        ...(items ? { items } : {}),
      };
    }
  }

  private async dispatch<T extends HostCommandType>(
    hostId: string,
    type: T,
    payload: CommandPayload<T>,
  ): Promise<CommandResults[T]> {
    const conn = this.connections.get(hostId);
    if (!conn) throw new RequestError("offline", "unknown host");
    const result = await conn.request(type, payload);
    for (const card of cardsIn(result)) this.onCard(hostId, card);
    if (isRun(result)) this.onRun(hostId, result);
    return result;
  }

  /**
   * Loads what the Sessões screen lists from every online host. Quiet: a host without history or
   * hub (older daemon) just contributes less.
   */
  refreshHub(): Promise<void> {
    return this.sessionLists.refresh();
  }

  /** Renames, pins or archives a session (managed or external) of a host. */
  async setMeta(
    hostId: string,
    claudeSessionId: string,
    patch: Partial<SessionMeta>,
  ): Promise<void> {
    const result = await this.hostCommand(hostId, "session.meta.set", {
      claudeSessionId,
      ...patch,
    });
    if (!result) return;
    const { claudeSessionId: _id, ...meta } = result;
    this.update({ meta: { ...this.state.meta, [sessionKey(hostId, claudeSessionId)]: meta } });
  }

  /**
   * Calls `listener` with the diff of a review target each time it changes on the host's disk
   * (phase 11); the host keeps watching while someone listens. Returns the function that stops.
   */
  watchChanges(
    hostId: string,
    target: string,
    listener: (update: ChangesUpdated) => void,
  ): () => void {
    const key = `${hostId}|${target}`;
    const listeners = this.changeListeners.get(key) ?? new Set();
    this.changeListeners.set(key, listeners);
    listeners.add(listener);
    this.connections.get(hostId)?.watchChanges(target);
    return () => {
      listeners.delete(listener);
      if (listeners.size > 0) return;
      this.changeListeners.delete(key);
      this.connections.get(hostId)?.unwatchChanges(target);
    };
  }

  /** Asks a host what the setup checklist needs from it: its hooks, GitHub, projects. */
  /**
   * Asks a host what the setup checklist reads: its hooks and its projects, at connect. GitHub runs
   * `gh auth status` on the host, so it is asked only with `github` (the Setup screen, the GitHub
   * panel); what it said last stays until then.
   */
  async refreshSetup(
    hostId: string,
    options: { github?: boolean; connect?: boolean } = {},
  ): Promise<void> {
    const host = this.state.hosts.find((h) => h.id === hostId);
    if (host?.status !== "online") return;
    const wants = setupWants(
      host.hostInfo?.features,
      options.connect !== true && this.state.projects[hostId] !== undefined,
      options.github === true,
    );
    const { hooks: wantsHooks, github: wantsGithub, projects: wantsProjects } = wants;
    if (!wantsHooks && !wantsGithub && !wantsProjects) return;
    const [hooks, github, projects] = await Promise.all([
      wantsHooks ? this.hostRequest(hostId, "hooks.status", {}) : null,
      wantsGithub ? this.hostRequest(hostId, "github.status", {}) : null,
      wantsProjects ? this.hostRequest(hostId, "project.list", {}) : null,
    ]);
    // The host may have gone while it was asked.
    if (!this.state.hosts.some((h) => h.id === hostId)) return;
    // At connect the probe's list is also the screens' (the sidebar tree needs it on any page, #721):
    // one request, not two.
    if (options.connect === true && wantsProjects && projects?.ok) {
      this.projectList.remember(hostId, projects.data.projects);
    }
    const probe = probeAfter(this.state.setupProbes[hostId], wants, { hooks, github, projects });
    this.update({ setupProbes: { ...this.state.setupProbes, [hostId]: probe } });
  }

  /** Asks the host for its `host.info` again (after a change of its settings). */
  async reloadHostInfo(hostId: string): Promise<void> {
    const conn = this.connections.get(hostId);
    if (conn) await this.loadHostInfo(hostId, conn);
  }

  /** Runs `fn` after `ms` (the store's timers, which tests drive); returns the function that cancels. */
  later(fn: () => void, ms: number): () => void {
    const timers = this.options.timers ?? REAL_TIMERS;
    const handle = timers.setTimeout(fn, ms);
    return () => timers.clearTimeout(handle);
  }

  /** Transcripts growing on any host (live reader); returns the function that stops it. */
  onHistoryChanged(listener: (hostId: string, change: HistoryChanged) => void): () => void {
    this.historyListeners.add(listener);
    return () => this.historyListeners.delete(listener);
  }

  /** Saves a file through the system dialog; errors go to the banner. */
  async saveFile(name: string, text: string): Promise<boolean> {
    try {
      return await this.platform.saveFile(name, text);
    } catch (error) {
      this.fail(error, (error as Error).message);
      return false;
    }
  }

  /** Copies a secret's value and clears the clipboard `clearMs` later (phase 16). */
  async copySecret(id: string, clearMs: number): Promise<boolean> {
    const value = await this.vault.value(id);
    if (value === null || !(await this.copyText(value))) return false;
    setTimeout(() => void this.platform.copyText("").catch(() => {}), clearMs);
    return true;
  }

  /** Whether a backup file can be picked here: false in a browser, which has no file dialog (#1264). */
  canReadBackup(): boolean {
    return this.platform.vault.canPick !== false;
  }

  /** Whether this app can open the system's folder dialog (the desktop app, not a browser). */
  canPickFolder(): boolean {
    return this.platform.pickFolder !== undefined;
  }

  /** The folder the user picks in the system dialog; null when they cancel or there is none. */
  async pickFolder(): Promise<string | null> {
    try {
      return (await this.platform.pickFolder?.()) ?? null;
    } catch (error) {
      this.fail(error);
      return null;
    }
  }

  /** The shell's log file, when the app has one (not in a browser). */
  platformLogs(): Platform["logs"] {
    return this.platform.logs;
  }

  async copyText(text: string): Promise<boolean> {
    try {
      await this.platform.copyText(text);
      this.success(this.i18n.t("toast.copied"));
      return true;
    } catch (error) {
      this.fail(error);
      return false;
    }
  }

  reportError(message: string): void {
    this.fail(new Error(message));
  }

  clearError(): void {
    this.update({ error: null });
  }

  /** A short success toast (copied, saved, started…), already translated. */
  success(text: string, link?: { label: string; run: () => void }): void {
    this.update({
      notices: [
        ...this.state.notices,
        { id: ++this.noticeSeq, kind: "success", code: "", text, ...(link ? { link } : {}) },
      ],
    });
  }

  /** Adds a folder to a host's allowed folders; `retry` runs once the host has accepted it. */
  async allowRoot(hostId: string, folder: string, retry?: () => void): Promise<boolean> {
    const result = await this.hostCommand(hostId, "roots.add", { path: folder, confirm: true });
    if (!result) return false;
    const conn = this.connections.get(hostId);
    if (conn?.info) conn.info = { ...conn.info, allowedRoots: result.allowedRoots };
    this.updateHost(hostId, (h) =>
      h.info ? { ...h, info: { ...h.info, allowedRoots: result.allowedRoots } } : h,
    );
    const host = this.state.hosts.find((h) => h.id === hostId)?.name ?? hostId;
    this.success(this.i18n.t("toast.rootAdded", { folder, host }));
    retry?.();
    return true;
  }

  /** A toast closed (or shown, for successes): it leaves the list. */
  dismissNotice(id: number): void {
    this.update({ notices: this.state.notices.filter((n) => n.id !== id) });
  }

  /**
   * A host's error: a toast titled by its code, with the daemon's message as the detail. `text`
   * replaces the old one-line form kept in `error` (and the detail of a codeless one).
   */
  private fail(error: unknown, text?: string, retry?: () => void, answersCommand = false): void {
    const code = error instanceof RequestError ? error.code : "";
    const message = error instanceof Error ? error.message : String(error);
    const prefix = code ? `${code}: ` : "";
    this.appLog.log("error", "refusal", `${prefix}${text ?? message}`);
    const notice: Notice = { id: ++this.noticeSeq, kind: "error", code, text: text ?? message };
    if (error instanceof RequestError && error.reason) {
      notice.reason = error.reason;
      notice.params = error.params ?? {};
    }
    if (error instanceof RequestError && error.hostId) notice.hostId = error.hostId;
    if (retry) notice.retry = retry;
    if (answersCommand) notice.answersCommand = true;
    // The same error again takes the old one's place (#581): one toast, the newest, with a fresh timer.
    this.update({
      error: text ?? describeError(error),
      notices: [...this.state.notices.filter((n) => !sameNotice(n, notice)), notice],
    });
  }

  createSession(hostId: string, payload: CommandPayload<"session.create">): Promise<string | null> {
    return this.commands.create(hostId, payload);
  }

  send(text: string, images?: SessionImage[]): Promise<void> {
    return this.commands.send(text, images);
  }

  interrupt(): Promise<void> {
    return this.commands.interrupt();
  }

  /** Whether the host took the mode (#935): false when it refused (said why), or no session is open. */
  setMode(permissionMode: SettableMode): Promise<boolean> {
    return this.commands.setMode(permissionMode);
  }

  setModel(model: string | null): Promise<void> {
    return this.commands.setModel(model);
  }

  setEffort(effort: EffortLevel | null): Promise<void> {
    return this.commands.setEffort(effort);
  }

  close(): Promise<void> {
    return this.commands.close();
  }

  resume(): Promise<void> {
    return this.commands.resume();
  }

  /** Answers a request from the "Precisa de você" queue, on whichever host it lives. */
  respondTo(
    hostId: string,
    requestId: string,
    decision: "allow" | "deny",
    answer: Answer = {},
  ): Promise<void> {
    return this.permissions.respondTo(hostId, requestId, decision, answer);
  }

  /** Answers an open gate, from the card or from the "Precisa de você" queue. */
  async respondGate(
    hostId: string,
    gate: Omit<GateRef, "cardId">,
    decision: "approve" | "reject",
    note?: string,
  ): Promise<void> {
    const { runId, stepId, attempt } = gate;
    await this.hostCommand(hostId, "gate.respond", {
      runId,
      stepId,
      attempt,
      decision,
      ...(note?.trim() ? { note: note.trim() } : {}),
    });
  }

  respond(requestId: string, decision: "allow" | "deny", answer: Answer = {}): Promise<void> {
    return this.permissions.respond(requestId, decision, answer);
  }

  /** The window coming back or the network returning is the moment to try the offline hosts. */
  private listenForWake(): void {
    const target = wakeTarget();
    if (typeof target.addEventListener !== "function") return;
    const wake = () => {
      for (const conn of this.connections.values()) conn.wake();
      // Hiding the window to the tray can drop its taskbar badge: say it again.
      this.inbox.resendBadge();
    };
    const visible = () => {
      if (typeof document === "undefined" || document.visibilityState !== "hidden") wake();
    };
    target.addEventListener("online", wake);
    target.addEventListener("focus", wake);
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", visible);
    this.stopWake = () => {
      target.removeEventListener?.("online", wake);
      target.removeEventListener?.("focus", wake);
      if (typeof document !== "undefined")
        document.removeEventListener("visibilitychange", visible);
    };
  }

  dispose(): void {
    this.stopWake?.();
    this.stopWake = null;
    if (this.peersTimer) clearInterval(this.peersTimer);
    this.peersTimer = null;
    if (this.awayTimer) clearInterval(this.awayTimer);
    this.awayTimer = null;
    for (const conn of this.connections.values()) conn.dispose();
    this.connections.clear();
    this.tray.stop();
    this.offQuit?.();
    this.offQuit = null;
    this.appUpdates.dispose();
    this.hostUpdate.dispose();
    this.backupScheduler.dispose();
    this.clientBudgets.dispose();
    this.vaultRules.dispose();
    this.theme.stop();
  }

  /** A host's command channel for a teleport's relay (issue #100): refusals come back as errors. */
  teleportRequest(hostId: string): TeleportRequest {
    // Straight to the connection: a host's teleport answer is checked by the relay, and never
    // reaches the board's card or run state on the way.
    return ((type, payload) => {
      const conn = this.connections.get(hostId);
      if (!conn) return Promise.reject(new RequestError("offline", "unknown host"));
      return conn.request(type, payload);
    }) as TeleportRequest;
  }

  /** Moves a session from `sourceHost` to the target the dialog picked (issue #100). */
  moveSession(
    sourceHost: string,
    sessionId: string,
    args: TeleportRunArgs,
  ): Promise<TeleportOutcome> {
    return teleportSession({
      source: this.teleportRequest(sourceHost),
      target: this.teleportRequest(args.target),
      sessionId,
      repo: args.repo,
      confirm: args.confirm,
      onProgress: args.onProgress,
      signal: args.signal,
    });
  }

  /** The session a move made, opened on its new host. */
  readonly openMovedSession = (hostId: string, sessionId: string): void => {
    this.select(hostId, sessionId);
    this.router.push({ name: "session", host: hostId, id: sessionId });
  };

  // -- internals ------------------------------------------------------------

  private connect(config: HostConfig, token: string): void {
    this.scan.rememberToken(token);
    const conn = new HostConnection({
      url: config.url,
      token,
      clientName: "flightdeck-desktop",
      hostId: config.id,
      ...(this.options.baseDelayMs !== undefined ? { baseDelayMs: this.options.baseDelayMs } : {}),
      ...(this.options.wakeDebounceMs !== undefined
        ? { wakeDebounceMs: this.options.wakeDebounceMs }
        : {}),
      ...(this.options.maxDelayMs !== undefined ? { maxDelayMs: this.options.maxDelayMs } : {}),
      lastSeqFor: (sessionId) =>
        this.state.sessions[sessionKey(config.id, sessionId)]?.lastSeq ?? 0,
      onStatus: (status) => this.onStatus(config.id, conn, status),
      onSubscribed: (sessionId, result) => this.stream.onSubscribed(config.id, sessionId, result),
      onPing: () => this.setLatency(config.id, conn.latencyMs),
      onEvent: (envelope) => this.stream.onEvent(config.id, envelope),
      onSummaries: (summaries) => this.summaries.apply(config.id, summaries),
      onCardUpdated: (card) => this.onCard(config.id, card),
      onExternal: (frame) => this.external.onExternal(config.id, frame),
      onVaultRequest: (request) => void this.vaultApprovals.onRequest(config, request),
      onVaultUsed: (used) => {
        this.usage.recordUsed(config.id, used);
        this.keepUsage();
      },
      // Phase 19: a security warning stays on screen until closed, and the OS shows it too.
      onTeams: (frame) => this.onTeams(config.id, frame),
      onMessagingAlert: (alert) => this.messaging.onLoopAlert(config.id, alert),
      onWatch: (frame) => this.prWatch.keep(config.id, frame.watch),
      onMessages: (frame) => {
        if (frame.type === "messages.updated") {
          for (const listener of this.messageListeners) listener(config.id, frame.message);
        }
        const deps = this.relayDeps();
        if (frame.type === "messages.relay") void relayMessage(deps, config.id, frame.message);
        else void relayUpdate(deps, config.id, frame.message);
      },
      onVaultAlert: (alert) => {
        const notice: Notice = {
          id: ++this.noticeSeq,
          kind: "error",
          code: "vault_alert",
          text: alert.message,
        };
        this.update({ notices: [...this.state.notices, notice] });
        this.inbox.notify({
          title: this.i18n.t("vaultAudit.alertTitle"),
          body: alert.message,
        });
      },
      onRunUpdated: (run) => this.onRun(config.id, run),
      onRunEnvUpdated: (state) => this.onRunEnv(config.id, state),
      onQuotaUpdated: (state) => this.quota.updated(config.id, state),
      onAccountUpdated: (state) => this.account.updated(config.id, state),
      onBudgetUpdated: (update) => this.budgets.onUpdated(config.id, update),
      onTerminal: (frame) => this.terminals.deliver(config.id, frame),
      onChangesUpdated: (update) => {
        for (const listener of this.changeListeners.get(`${config.id}|${update.target}`) ?? []) {
          listener(update);
        }
      },
      onHistoryChanged: (change) => {
        for (const listener of this.historyListeners) listener(config.id, change);
      },
      onAskpass: (request) => void this.ssh.onAskpass(config.id, request),
    });
    this.connections.set(config.id, conn);
    // A session selected before its host had a connection (a route opened at start-up).
    const selected = this.state.selected;
    if (selected?.hostId === config.id && selected.sessionId) conn.subscribe(selected.sessionId);
    for (const key of this.watched.keys()) {
      if (key.startsWith(`${config.id}/`)) conn.subscribe(key.slice(config.id.length + 1));
    }
    conn.watch();
    conn.watchBoard();
    conn.watchHistory();
    conn.watchExternal();
    conn.watchRuns();
    conn.watchRunEnv();
    conn.watchQuota();
    conn.watchBudgets();
    conn.watchVault();
    conn.connect();
  }

  private onStatus(hostId: string, conn: HostConnection, status: ConnectionStatus): void {
    const name = this.state.hosts.find((h) => h.id === hostId)?.name ?? hostId;
    const line = statusLine(name, status, conn.lastDrop);
    this.appLog.log(line.level, "host", line.text);
    this.updateHost(hostId, (h) => ({
      ...h,
      status,
      info: conn.info,
      incompatibility: conn.incompatibility,
      retry: conn.retry,
    }));
    if (status === "online") {
      void this.loadHostInfo(hostId, conn, true);
      // Daemons before phase 7 have no quota: quietly nothing.
      void conn.request("quota.get", {}).then(
        (state) => this.quota.updated(hostId, state),
        () => {},
      );
    }
    if (status !== "online") this.terminals.tellOffline(hostId);
    if (status === "connecting") this.stream.dropPartialText(hostId);
  }

  /** Daemons without `host.info` (phase 1) answer with an error: the page says so. */
  private async loadHostInfo(hostId: string, conn: HostConnection, connect = false): Promise<void> {
    const hostInfo = await conn.request("host.info", {}).catch(() => null);
    this.updateHost(hostId, (h) => {
      // Back on the version it was updating to: the update is over.
      const done = h.daemonUpdate && hostInfo?.daemonVersion === h.daemonUpdate.target;
      if (done) this.hostUpdate.settled(hostId);
      return { ...h, hostInfo, infoAt: Date.now(), ...(done ? { daemonUpdate: null } : {}) };
    });
    // The setup checklist reads what this host has: its hooks, GitHub, projects.
    void this.refreshSetup(hostId, { connect });
    // Issue #1344: a host that can say what happened while the app was closed is asked once.
    if (hasFeature(hostInfo?.features, "activity", false)) void this.activity.loadAway();
    // ssh asks for passwords through the daemon: this app is who answers.
    if (hasFeature(hostInfo?.features, "ssh", false)) {
      void conn.request("askpass.watch", {}).catch(() => null);
    }
    // Phase 21: this app carries the host's messages for the other hosts.
    if (hasFeature(hostInfo?.features, "watch", false)) {
      void conn.request("watch.watch", {}).catch(() => null);
    }
    if (hasFeature(hostInfo?.features, "teams", false)) {
      void conn.request("teams.watch", {}).catch(() => null);
      // The sessions that belong to teams, so the workers' notifications can be folded.
      void conn
        .request("teams.list", {})
        .then((result) => {
          for (const team of result.teams) this.summaries.rememberTeam(hostId, team);
        })
        .catch(() => null);
    }
    if (hasFeature(hostInfo?.features, "messaging", false)) {
      void conn.request("messages.watch", {}).catch(() => null);
      this.startPeersSync();
    }
    // Phase 19: the daemon decides a request with the rules the app hands it.
    if (hasFeature(hostInfo?.features, "actions", false)) this.vaultRules.onConnect(hostId, conn);
    void this.health.check(hostId);
    // Not awaited, as the health check: a reload of the host's info never waits on the offer.
    if (hasFeature(hostInfo?.features, FEATURE_RESUME_OFFER, false))
      void this.sessions.offerResume(hostId, conn);
    if (hasFeature(hostInfo?.features, "costs", false)) {
      const list = await conn.request("budget.list", {}).catch(() => null);
      if (list) this.budgets.replace(hostId, list.budgets);
    }
  }

  /** A team changed on a host: kept, told to the page, and, when it is news, notified. */
  private onTeams(hostId: string, frame: TeamsUpdatedFrame): void {
    this.summaries.rememberTeam(hostId, frame.team);
    for (const listener of this.teamListeners) listener(hostId, frame);
    // #1220: the coordinator reported the goal done; the host sends it once per final report.
    const body = frame.event === "report_done" ? this.i18n.t("teamsUi.reportDone") : frame.reason;
    if (body) {
      this.inbox.notify(
        { title: this.i18n.t("teamsUi.notifyTitle", { name: frame.team.name }), body },
        { name: "teams", host: hostId, team: frame.team.id },
      );
    }
  }

  /** `hostId/projectId` of the project whose folder holds `cwd`, if any. */
  private sessionProject(hostId: string, cwd: string | null | undefined): string | undefined {
    const project = cwd
      ? (this.state.projects[hostId] ?? []).find((p) => isInside(cwd, p.path))
      : undefined;
    return project ? `${hostId}/${project.id}` : undefined;
  }

  /** The sessions an area shows right now (the active tab of each area), by session key. */
  private shownSessions(): Set<string> {
    const shown = new Set<string>();
    if (this.hostTabs.onShared) return shown;
    for (const area of this.workspace.areas) {
      const route = area.router.current;
      if (route.name === "session") shown.add(sessionKey(route.host, route.id));
    }
    return shown;
  }

  /** A session on screen is read. */
  private clearShownUnread(): void {
    const shown = [...this.shownSessions()].filter((key) => this.state.unread[key]);
    if (shown.length === 0) return;
    const unread = { ...this.state.unread };
    for (const key of shown) delete unread[key];
    this.update({ unread });
  }

  /**
   * A secret of the vault for a use the app itself starts (ssh): the delivery rules are checked
   * for the host that will use it and the use is logged, as "you". The value is handed to the
   * caller and kept nowhere.
   */
  async vaultSecretFor(
    hostId: string,
    secretId: string,
    purpose: string,
  ): Promise<{ ok: true; value: string } | { ok: false; code: DeliveryRefusal }> {
    const host = this.state.hosts.find((h) => h.id === hostId);
    const check = await checkDelivery(secretId, {
      hostId,
      hostUrl: host?.url ?? "",
      vault: this.vault,
    });
    this.usage.recordOutcome({
      hostId,
      secretId,
      purpose,
      requester: "you",
      delivered: check.ok,
      reason: check.ok ? "" : check.reason,
    });
    this.keepUsage();
    return check.ok ? { ok: true, value: check.value } : { ok: false, code: check.code };
  }

  /** Phase 16: the vault, whose values live in the system keyring. */
  readonly vault: Vault;

  /** Phase 19: each secret's usage rules, kept with the vault and handed to the hosts (#1596). */
  readonly vaultRules: VaultRulesSlice;
  /** The vault's secrets and their `.fdvault` file; `state.secrets` is the list the screens read. */
  readonly secrets: VaultSecretsSlice;
  /** The daemon's requests for a secret: the policy, the queue and the outcome listeners. */
  readonly vaultApprovals: VaultApprovalsSlice;
  /** What the app's log and the screens must never show: the hosts' tokens and the vault's values. */
  readonly scan: VaultScanSlice;
  /** Home's last numbers per host set and period (issue #607). */
  readonly homeCache: HomeCache;
  /** Whether the release notes of an update were not opened yet (issue #125). */
  readonly whatsNew: WhatsNew;
  /** Phase 29: the clients, their rules and overrides, kept by the app. */
  readonly clients: Clients;
  /** Phase 36: the rates, the plan price and the people, kept by the app. */
  readonly roi: RoiSettings;
  /** The ROI figures: the day they end on, each host's summary and a project's money (#1596). */
  readonly roiFigures: RoiSlice;
  /** Phase 30: the webhook targets and the sending. */
  readonly webhooks: Webhooks;
  private readonly webhookFeed: WebhookFeed;
  /** Which client the person works for: the selection of the work screens and each project's client (#1596). */
  readonly clientScope: ClientScopeSlice;
  /** Phase 16: what was asked of the vault, kept in `storage`. */
  readonly usage: VaultUsageLog;

  private keepUsage(): void {
    this.update({ vaultUsage: this.usage.list() });
  }

  private peersTimer: ReturnType<typeof setInterval> | null = null;
  private readonly messageListeners = new Set<(hostId: string, message: MessageInfo) => void>();
  private readonly teamListeners = new Set<(hostId: string, frame: TeamsUpdatedFrame) => void>();

  /**
   * Phase 30: posts a webhook through an online host that can (the URL goes there for this one use,
   * over the vault's transport). A request the host refuses counts as a permanent 400.
   */
  private async relayWebhook(request: WebhookRequest): Promise<WebhookResponse> {
    const host = this.state.hosts.find(
      (h) => h.status === "online" && hasFeature(h.hostInfo?.features, "webhook", false),
    );
    if (!host) return { status: null, retryAfterMs: null };
    try {
      const result = await this.dispatch(host.id, "webhook.send", request);
      return {
        status: result.refused === null ? result.status : 400,
        retryAfterMs: result.retryAfterMs,
      };
    } catch {
      return { status: null, retryAfterMs: null };
    }
  }

  /** Phase 30: the summary of a session of a host; null when the host cannot give one. */
  async sessionRecap(
    hostId: string,
    claudeSessionId: string,
    extra: { question?: string } = {},
  ): Promise<SessionRecap | null> {
    const host = this.state.hosts.find((h) => h.id === hostId);
    if (!hasFeature(host?.hostInfo?.features, "summary", false)) return null;
    try {
      return await this.dispatch(hostId, "session.summary", { claudeSessionId, ...extra });
    } catch {
      return null;
    }
  }

  /** The PR watch of the cards: each card's watch, its commands and the screen a PR link opens (#1596). */
  readonly prWatch: WatchSlice;
  /** The projects each host lists: the list, a project's key and its PR provider (#1596). */
  readonly projectList: ProjectsSlice;

  /** Issue #1478: keeps a quiet session out of Needs you for an hour ("Not stuck"). */
  snoozeQuiet(hostId: string, sessionId: string): void {
    const until = this.now() + QUIET_SNOOZE_MS;
    const quietSnooze = { ...this.state.quietSnooze, [sessionKey(hostId, sessionId)]: until };
    this.update({ quietSnooze });
    saveQuietSnooze(this.platform.storage, quietSnooze);
    // The row is gone from the list: say when it comes back (#1554).
    this.success(
      this.i18n.t("needsYou.quietSnoozed", {
        time: this.formatTime(new Date(until).toISOString()),
      }),
    );
  }

  /** Issue #1478: interrupts any session of a host, open or not. */
  async interruptSession(hostId: string, sessionId: string): Promise<void> {
    try {
      await this.connections.get(hostId)?.request("session.interrupt", { sessionId });
    } catch (error) {
      this.fail(error);
    }
  }

  /** Phase 21: told each time a team of a host changes. */
  onTeamsUpdated(listener: (hostId: string, frame: TeamsUpdatedFrame) => void): () => void {
    this.teamListeners.add(listener);
    return () => {
      this.teamListeners.delete(listener);
    };
  }

  /** Phase 21: told each time a message between sessions changes on a host. */
  onMessageUpdated(listener: (hostId: string, message: MessageInfo) => void): () => void {
    this.messageListeners.add(listener);
    return () => {
      this.messageListeners.delete(listener);
    };
  }

  /** Phase 21: the hosts as the relay sees them; only an online one with messaging takes part. */
  private relayDeps(): RelayDeps {
    return {
      hosts: () =>
        this.state.hosts.map((h) => ({
          id: h.id,
          hostName: h.hostInfo?.hostName ?? "",
          online: h.status === "online" && hasFeature(h.hostInfo?.features, "messaging", false),
        })),
      call: (hostId, type, payload) =>
        this.dispatch(hostId, type as HostCommandType, payload as never),
    };
  }

  /** Keeps every daemon told of the other hosts' sessions, so a message can name them. */
  private startPeersSync(): void {
    const sync = () => void syncPeers(this.relayDeps()).catch(() => {});
    sync();
    this.peersTimer ??= setInterval(sync, this.options.peersSyncMs ?? 5000);
  }

  private onRun(hostId: string, run: WorkflowRun): void {
    this.update({ runs: { ...this.state.runs, [sessionKey(hostId, run.id)]: run } });
  }

  private onCard(hostId: string, card: Card): void {
    const { [sessionKey(hostId, card.id)]: previous, ...others } = this.state.cards;
    // Phase 31: a card the app already knew has just lost its last blocker.
    if (!card.discarded && card.unblockedAt && previous && !previous.unblockedAt) {
      this.inbox.notify(
        {
          title: this.i18n.t("deps.notifyTitle"),
          body: this.i18n.t("deps.notifyBody", { title: card.title }),
        },
        { name: "card", host: hostId, projectId: card.projectId, cardId: card.id },
        card.prUrl,
      );
    }
    const cards = card.discarded ? others : { ...others, [sessionKey(hostId, card.id)]: card };
    this.update({ cards });
  }

  /** A host's open connection; its callers have checked `connections.has` first. */
  private openConnection(hostId: string): HostConnection {
    const conn = this.connections.get(hostId);
    if (!conn) throw new Error(`no connection for ${hostId}`);
    return conn;
  }

  private updateHost(hostId: string, fn: (host: HostView) => HostView): void {
    this.update({ hosts: this.state.hosts.map((h) => (h.id === hostId ? fn(h) : h)) });
  }

  private persistHosts(): void {
    saveHosts(
      this.platform.storage,
      this.state.hosts.map(({ id, name, url }) => ({ id, name, url })),
    );
  }

  private update(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    if (patch.hosts || patch.externalRequests) this.inbox.rememberWaiting();
    if (patch.secrets) void this.scan.refresh();
    if (patch.hosts) this.clientBudgets.onHostsChanged();
    if (patch.hub || patch.projects) this.vaultRules.scopeChanged();
    this.tray.changed(patch);
    for (const listener of this.listeners) listener();
  }

  /**
   * A new language: the tray's texts change at once and every screen renders again.
   */
  private onLanguage(): void {
    this.tray.languageChanged();
    for (const listener of this.listeners) listener();
  }
}
