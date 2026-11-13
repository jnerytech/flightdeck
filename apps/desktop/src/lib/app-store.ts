import type {
  ChangesUpdated,
  CommandPayload,
  CommandResults,
  HistoryChanged,
  SessionRecap,
  WorkflowRun,
} from "@flightdeck/protocol";
import { FEATURE_RESUME_OFFER, inSequence } from "@flightdeck/protocol";
import { SystemSlice } from "@/features/shell/system.ts";
import { WORKSPACE_KEY, Workspace } from "@/features/shell/workspace.ts";
import { isInside, nullOnError } from "@/shared/lib/index.ts";
import { sameNotice } from "../app/notice-lifetime.ts";
import { type AccountSlice, initialAccountState, wireAccount } from "../features/account/index.ts";
import { type ActivitySlice, wireActivity } from "../features/activity/index.ts";
import { type AssistantController, wireAssistant } from "../features/assistant/index.ts";
import { type BackgroundSlice, wireBackground } from "../features/background/index.ts";
import {
  type Attention,
  BackupScheduler,
  type BackupSlice,
  googleConfig,
  wireBackup,
} from "../features/backup/index.ts";
import { BoardCardsSlice } from "../features/board/index.ts";
import {
  type ClientScopeSlice,
  Clients,
  knownProjects,
  UNASSIGNED,
  wireClientScope,
} from "../features/clients/index.ts";
import {
  type BudgetsSlice,
  type ClientBudgetsSlice,
  hubHostScope,
  localDay,
  wireBudgets,
  wireClientBudgets,
} from "../features/costs/index.ts";
import { type HistorySlice, wireHistory } from "../features/history/index.ts";
import {
  type ConnectionStatus,
  type HealthSlice,
  type HostConfig,
  type HostConnection,
  HostLink,
  HostRosterSlice,
  type HostRoutes,
  HostTabs,
  type HostUpdateSlice,
  initialHealthState,
  loadHosts,
  type OnlineStep,
  RequestError,
  saveHosts,
  statusLine,
  wireHealth,
  wireHostUpdate,
} from "../features/hosts/index.ts";
import { type InboxSlice, wireInbox } from "../features/inbox/index.ts";
import { type MessagingSlice, wireMessaging } from "../features/messaging/index.ts";
import { type PermissionsSlice, wirePermissions } from "../features/permissions/index.ts";
import { type PersonasSlice, wirePersonas } from "../features/personas/index.ts";
import {
  ProjectKeys,
  type ProjectsSlice,
  type WorktreeFilter,
  wireProjects,
} from "../features/projects/index.ts";
import { initialQuotaState, type QuotaSlice, wireQuota } from "../features/quota/index.ts";
import { type RoiSlice, wireRoi } from "../features/roi/index.ts";
import { RoiSettings } from "../features/roi/roi-settings.ts";
import { RunEnvSlice } from "../features/runenv/store.ts";
import {
  type ExternalSessionsSlice,
  type FinishedSlice,
  HISTORY_LIST_LIMIT,
  hubRows,
  type SessionActions,
  type SessionCommandsSlice,
  type SessionListsSlice,
  type SessionStreamSlice,
  type SessionSubscriptions,
  type SessionsSlice,
  SessionViews,
  type SummariesSlice,
  sessionKey,
  takeHubHost,
  wireExternalSessions,
  wireFinished,
  wireSessionActions,
  wireSessionCommands,
  wireSessionLists,
  wireSessionStream,
  wireSessionSubscriptions,
  wireSessions,
  wireSummaries,
} from "../features/sessions/index.ts";
import { SetupProbes, SetupSettings } from "../features/setup/index.ts";
import { type SnippetsSlice, wireSnippets } from "../features/snippets/index.ts";
import { type SshSlice, wireSsh } from "../features/ssh/index.ts";
import type { Navigation, Tabs } from "../features/tabs/tabs.ts";
import { TeamsSlice } from "../features/teams/store.ts";
import { SessionMover } from "../features/teleport/teleport.ts";
import { type TerminalsSlice, wireTerminals } from "../features/terminal/index.ts";
import { isLocalUrl } from "../features/terminal/terminal.ts";
import { type TraySlice, wireTray } from "../features/tray/index.ts";
import {
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
import { type WatchSlice, wireWatch } from "../features/watch/index.ts";
import { WebhookFeed } from "../features/webhook/webhook-feed.ts";
import { Webhooks } from "../features/webhook/webhooks.ts";
import { refusalText } from "../i18n/errors.ts";
import { formatDateTime, formatTime, formatWhen } from "../i18n/format.ts";
import { I18n } from "../i18n/index.ts";
import type { Platform, WebhookRequest, WebhookResponse } from "../platform/types.ts";
import type {
  Answer,
  AppState,
  AppStoreOptions,
  GateRef,
  HostView,
  Notice,
  ReleaseNotesResult,
} from "./app-state.ts";
import { initialAppState, needsYou } from "./app-state.ts";
import { composeShell, type ShellSlices } from "./compose/shell.ts";
import type { AppKernel, HostCommandOptions, HostCommandType, HostResult } from "./kernel.ts";
import { hasFeature } from "./version.ts";

/** The state's types and pure functions live in `app-state.ts`; screens import them from here until each binds its slice (#1596). */
export type {
  Answer,
  AppState,
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

/** The window kept by the last run; nothing (a fresh window) when it is missing or unreadable. */
function storedWorkspace(storage: Platform["storage"]): unknown {
  try {
    return JSON.parse(storage.getItem(WORKSPACE_KEY) ?? "null");
  } catch {
    return null;
  }
}

export { PALETTE_RECENTS_KEY } from "@/features/palette/palette-store.ts";

export { sessionKey };

const REAL_TIMERS = {
  setTimeout: (fn: () => void, ms: number): unknown => setTimeout(fn, ms),
  clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

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

function describeError(error: unknown): string {
  return error instanceof RequestError ? `${error.code}: ${error.message}` : String(error);
}

/**
 * The slices each composition module builds are the store's fields: the constructor assigns them
 * (`Object.assign`), and the merged interface gives them their types (#2376).
 */
export interface AppStore extends ShellSlices {}

/**
 * All app state in one framework-free store: hosts and their connections, session timelines and
 * the current selection. React reads it through `useSyncExternalStore`.
 */
// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: the compose modules build these fields; each returns a typed record, so none is left unset
export class AppStore {
  private state: AppState;
  private readonly listeners = new Set<() => void>();
  /** #1596: the connections to the hosts, built, woken and closed there. */
  private readonly link = new HostLink({
    options: () => this.options,
    rememberToken: (token) => this.scan.rememberToken(token),
    lastSeqFor: (hostId, sessionId) =>
      this.state.sessions[sessionKey(hostId, sessionId)]?.lastSeq ?? 0,
    selected: () => this.state.selected,
    watched: () => this.subscriptions.followed(),
    onStatus: (hostId, conn, status) => this.onStatus(hostId, conn, status),
    // Read at connect: the table is a field declared after this one.
    routes: () => this.routes,
    // Read at load, after the `host.info` answer: also declared after this field.
    onlineSteps: () => this.onlineSteps,
    // Hiding the window to the tray can drop its taskbar badge: say it again.
    onWake: () => this.inbox.resendBadge(),
  });
  /** The tray and the window title that follow the state (phase 8, issue #88, #1596). */
  readonly tray: TraySlice;
  /** Answering a permission request, with the hold a high-risk allow needs (#245, #1596). */
  readonly permissions: PermissionsSlice;
  private noticeSeq = 0;
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
  private readonly historyListeners = new Set<(hostId: string, change: HistoryChanged) => void>();
  private offQuit: (() => void) | null = null;

  /** The history read from every host (#1596): its global search. */
  readonly history: HistorySlice;
  /** What happened on the hosts while the app was away (issue #1344, #1596). */
  readonly activity: ActivitySlice;
  /** The sessions a restart interrupted, and the offer to resume them (issue #150, #1596). */
  readonly sessions: SessionsSlice;
  /** The messages between sessions: the loops a host paused (phase 21, #1596). */
  readonly messaging: MessagingSlice;
  /** The teams of the hosts: their changes, told and notified (`features/teams/store.ts`). */
  readonly teams: TeamsSlice;
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
  /** A card's run environment: run.yaml, trust, start and stop (`features/runenv/store.ts`). */
  readonly runEnv: RunEnvSlice;
  /** A host's daemon update: asked for, checked, and watched until it comes back (#1596). */
  readonly hostUpdate: HostUpdateSlice;
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
    connection: (hostId) => this.link.connection(hostId),
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
    Object.assign(
      this,
      composeShell(this.kernel, {
        platform,
        appUpdateIntervalMs: () => this.options.appUpdateIntervalMs,
        updateHost: (hostId, change) => this.updateHost(hostId, change),
        formatTime: (iso) => this.formatTime(iso),
        secretValues: () => this.scan.values(),
        openSearch: () => this.history.openSearch(),
        palette: {
          loadProjects: (hostId) => this.projectList.load(hostId),
          loadBoard: (hostId, projectId) => this.boardCards.load(hostId, projectId),
          loadSshTargets: (hostId) => this.ssh.loadTargets(hostId),
          loadPersonas: (hostId) => this.personas.load(hostId),
          listSnippets: (hostId) => nullOnError(this.dispatch(hostId, "snippets.list", {})),
          keepSnippets: (hostId, snippets) => this.snippets.keep(hostId, snippets),
          refreshHub: () => this.refreshHub(),
        },
      }),
    );
    this.system = new SystemSlice({
      platform,
      localHost: (hostId) => {
        const host = this.state.hosts.find((h) => h.id === hostId);
        return host !== undefined && isLocalUrl(host.url);
      },
      fail: (error, text) => this.fail(error, text),
      success: (text) => this.success(text),
      copiedText: () => this.i18n.t("toast.copied"),
    });
    this.history = wireHistory(this.kernel, {
      searchTimeoutMs: options.searchTimeoutMs,
      select: (hostId, sessionId) => this.select(hostId, sessionId),
      listLimit: HISTORY_LIST_LIMIT,
      offline: () => new RequestError("offline", "unknown host"),
      reason: (error) => (error instanceof RequestError ? error.reason : undefined),
    });
    this.activity = wireActivity(this.kernel, { since: () => this.awayClock.since() });
    this.sessions = wireSessions(this.kernel, { storage: platform.storage });
    this.personas = wirePersonas(this.kernel, {
      storage: platform.storage,
      language: () => this.i18n.lang,
    });
    this.ssh = wireSsh(this.kernel, {
      hasSecret: (secretId) => this.vault.list().some((secret) => secret.id === secretId),
      secretFor: (hostId, secretId) => this.vaultApprovals.secretFor(hostId, secretId, "ssh"),
    });
    this.health = wireHealth(this.kernel);
    this.hostUpdate = wireHostUpdate(this.kernel, {
      patch: (hostId, patch) => this.updateHost(hostId, (h) => ({ ...h, ...patch })),
      open: (hostId) => this.link.open(hostId),
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
    this.runEnv = new RunEnvSlice({
      state: () => this.state,
      update: (patch) => this.update(patch),
      key: sessionKey,
      config: (hostId, projectId) => this.hostCommand(hostId, "runenv.config", { projectId }),
      trust: (hostId, projectId, hash) =>
        this.hostCommand(hostId, "runenv.trust", { projectId, hash }),
      start: (hostId, cardId) => this.hostCommand(hostId, "runenv.start", { cardId }),
      stop: (hostId, cardId) => this.hostCommand(hostId, "runenv.stop", { cardId }),
    });
    this.snippets = wireSnippets(this.kernel, { storage: platform.storage });
    this.budgets = wireBudgets(this.kernel, {
      feed: (host, label, percent, limit) => this.webhookFeed.budget(host, label, percent, limit),
      notify: (notification, route, source) =>
        this.inbox.notify(notification, route, undefined, source),
    });
    this.messaging = wireMessaging(this.kernel, {
      notify: (notification) => this.inbox.notify(notification),
      // Phase 21: only an online host with messaging takes part in the relay.
      relayHosts: () =>
        this.state.hosts.map((h) => ({
          id: h.id,
          hostName: h.hostInfo?.hostName ?? "",
          online: h.status === "online" && hasFeature(h.hostInfo?.features, "messaging", false),
        })),
      peersSyncMs: this.options.peersSyncMs,
    });
    this.teams = new TeamsSlice({
      remember: (hostId, team) => this.summaries.rememberTeam(hostId, team),
      notify: (notification, route) => this.inbox.notify(notification, route),
      t: () => this.i18n.t,
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
      const from = left ?? this.uiModes.hostId();
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
      copyText: (text) => this.system.copyText(text),
      clearClipboardIn: (ms) => {
        setTimeout(() => void this.platform.copyText("").catch(() => {}), ms);
      },
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
    this.assistant = wireAssistant(this.kernel, {
      storage: platform.storage,
      api: platform.assistant,
      language: () => this.i18n.lang,
    });
    this.setup = new SetupSettings(platform.storage);
    this.setupProbes = new SetupProbes({
      host: (hostId) => {
        const host = this.state.hosts.find((h) => h.id === hostId);
        return host && { status: host.status, features: host.hostInfo?.features };
      },
      projectsRead: (hostId) => this.state.projects[hostId] !== undefined,
      request: (hostId, type, payload) => this.hostRequest(hostId, type, payload),
      rememberProjects: (hostId, projects) => this.projectList.remember(hostId, projects),
      probes: () => this.state.setupProbes,
      setProbes: (setupProbes) => this.update({ setupProbes }),
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
      copyText: (text) => this.system.copyText(text),
      spawn: (program, args) => this.platform.terminal.open(program, args),
      describeError,
    });
    this.roster = new HostRosterSlice({
      secrets: platform.secrets,
      hosts: () => this.state.hosts,
      list: (config) => this.update({ hosts: [...this.state.hosts, newHostView(config)] }),
      persist: () => this.persistHosts(),
      connect: (config, token) => this.link.connect(config, token),
      stop: (hostId) => this.link.stop(hostId),
      detach: (hostId) => {
        this.hostTabs.removeHost(hostId);
        this.vaultApprovals.hostGone(hostId);
        this.link.remove(hostId);
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
      addRoot: (hostId, path) => this.hostCommand(hostId, "roots.add", { path, confirm: true }),
      setAllowedRoots: (hostId, allowedRoots) => {
        const conn = this.link.connection(hostId);
        if (conn?.info) conn.info = { ...conn.info, allowedRoots };
        this.updateHost(hostId, (h) => (h.info ? { ...h, info: { ...h.info, allowedRoots } } : h));
      },
      success: (text) => this.success(text),
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
    // Built here, not in a board wire: a wire importing the kernel would join its import cycle (#1624).
    this.boardCards = new BoardCardsSlice({
      cards: () => this.kernel.state().cards,
      setCards: (cards) => this.kernel.update({ cards }),
      connection: (hostId) => this.kernel.connection(hostId),
      notify: (notification, route, fallbackUrl) =>
        this.inbox.notify(notification, route, fallbackUrl),
      t: () => this.kernel.t(),
    });
    this.i18n = new I18n(platform);
    this.backupScheduler = new BackupScheduler(platform, {
      onAttention: (kind) => this.onBackupAttention(kind),
      google: options.google ?? { config: googleConfig() },
      ...(options.vaultWorkFactor !== undefined && { workFactor: options.vaultWorkFactor }),
    });
    this.backup = wireBackup(this.kernel, {
      platform,
      scheduler: this.backupScheduler,
      vaultWorkFactor: options.vaultWorkFactor,
    });
    this.commands = wireSessionCommands(this.kernel, {
      opened: (hostId, sessionId) => {
        this.select(hostId, sessionId);
        // A new session opens, wherever it was created from (phase 10).
        this.history.closeSearch();
        this.router.push({ name: "session", host: hostId, id: sessionId });
      },
    });
    this.permissions = wirePermissions(this.kernel, {
      needsYou: () => needsYou(this.state, this.i18n.t),
      settleVault: (requestId, answer) => this.vaultApprovals.settle(requestId, answer),
      sendSelected: (response) =>
        this.commands.onSelected((conn) => conn.request("permission.respond", response)),
      showWindow: () => void this.platform.showMainWindow(),
      act: (action) => this.tray.act(action),
    });
    this.sessionActions = wireSessionActions(this.commands, {
      copyText: (text) => this.system.copyText(text),
      respond: (requestId, decision, answer) =>
        this.permissions.respond(requestId, decision, answer ?? {}),
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
    this.subscriptions = wireSessionSubscriptions(this.kernel);
    this.stream = wireSessionStream(this.kernel, {
      summary: (hostId, event) => this.summaries.apply(hostId, [event]),
    });
    this.finished = wireFinished(this.kernel, {
      storage: platform.storage,
      isFocused: () => this.platform.isFocused(),
      shown: () => this.shownSessions(),
    });
    this.summaries = wireSummaries(this.kernel, {
      setSessions: (hostId, sessions) => this.updateHost(hostId, (h) => ({ ...h, sessions })),
      shown: () => this.shownSessions(),
      projectOf: (hostId, cwd) => this.sessionProject(hostId, cwd),
      isSimple: (hostId) => this.uiModes.mode(hostId).mode === "simple",
      isFocused: () => this.platform.isFocused(),
      prefs: () => this.notifyPrefs.value,
      notify: (...args) => this.inbox.notify(...args),
      feed: (host, prev, next) => this.webhookFeed.managed(host, prev, next),
      finished: (hostId, prev, next) => this.finished.record(hostId, prev, next),
      later: (fn, ms) => void this.later(fn, ms),
    });
    this.tray = wireTray(this.kernel, {
      platform,
      needsYou: () => needsYou(this.state, this.i18n.t),
      uiHostId: () => this.uiModes.hostId(),
      isSimple: (hostId) => this.uiModes.mode(hostId).mode === "simple",
      answer: (hostId, requestId, decision) => void this.respondTo(hostId, requestId, decision),
      open: (item) => this.permissions.open(item),
      timers: options.timers ?? REAL_TIMERS,
    });
    this.i18n.subscribe(() => this.onLanguage());
    this.state = initialAppState(platform, {
      now: (options.now ?? Date.now)(),
      vaultUsage: this.usage.list(),
      clientList: this.clients.list(),
      clientOverrides: this.clients.overrides(),
    });
  }

  /** Phase 40: the AI assistant's preferences, keys state and the wand's requests. */
  readonly assistant: AssistantController;
  /** Where a wand with no provider sends the person: Settings, section Assistant (issue #162). */
  readonly openAssistantSettings = (): void =>
    this.router.push({ name: "settings", section: "assistant" });
  /** Issue #107: the view each session tab was on, and the page now on screen. */
  readonly sessionViews = new SessionViews();
  /** The setup checklist: hidden or not, and whether a test notification ever showed. */
  readonly setup: SetupSettings;
  /** #1596: what the setup checklist asked each host. */
  private readonly setupProbes: SetupProbes;
  /** The project keys any screen has read, for one label per project everywhere (issue #881). */
  readonly projectKeys = new ProjectKeys();
  /** The notification center (the bell), the taskbar badge, the OS toast and the sound (#1596). */
  readonly inbox: InboxSlice;
  /** The board cards the app has seen: sent, answered with, or loaded with a board (#1596). */
  readonly boardCards: BoardCardsSlice;
  /** The teleport's channels and moves (#1596); the connection is read when a move asks. */
  readonly mover = new SessionMover((hostId) => this.link.connection(hostId));
  /** Which hosts the app has: adding, removing, naming, pairing again and reconnecting (#1596). */
  readonly roster: HostRosterSlice;
  /** The terminals of every host: their commands, tabs, "Claude aqui" and the close that asks (#1596). */
  readonly terminals: TerminalsSlice;
  /** pt-BR or English, and the translator (phase 10). */
  readonly i18n: I18n;
  /** Issue #1264: scheduled backups to a picked folder (the desktop app only). */
  readonly backupScheduler: BackupScheduler;
  /** The whole-app backup file: save, read, compare and restore (#1596). */
  readonly backup: BackupSlice;
  private awayTimer: ReturnType<typeof setInterval> | null = null;
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

  getLatency = (hostId: string): number | null => this.link.getLatency(hostId);

  /** For the one component that shows a latency; a heartbeat never reaches `subscribe`. */
  subscribeLatency = (listener: () => void): (() => void) => this.link.subscribeLatency(listener);

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async init(): Promise<void> {
    this.inbox.load();
    this.finished.load();
    this.inbox.syncBadge();
    // Reset synchronously first: nothing from a previous init may stay visible while awaiting.
    this.dispose();
    this.link.listenForWake();
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
      if (token) this.link.connect(config, token);
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

  /** Starts the poll the GitHub panel runs while a sign-in waits; the returned function stops it. */
  githubTicker(tick: () => void): () => void {
    if (this.options.githubTicker) return this.options.githubTicker(tick);
    const timer = setInterval(tick, 1500);
    return () => clearInterval(timer);
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
    this.subscriptions.select(hostId, sessionId);
  }

  /** The host the switcher shows: the active tab's, or the last one used on a shared tab. */
  activeHostId(): string | null {
    return this.hostTabs.hostId;
  }

  /** A new tab; the host tabs choose where (`HostTabs.openNew`). */
  openNewTab(): void {
    this.hostTabs.openNew(this.state.hosts);
  }

  /** Picks the checkout the board and the Sessions list narrow to, or clears it. */
  setWorktreeFilter(filter: WorktreeFilter | null): void {
    this.update({ worktreeFilter: filter });
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
    const conn = this.link.connection(hostId);
    if (!conn) throw new RequestError("offline", "unknown host");
    const result = await conn.request(type, payload);
    this.boardCards.onResult(hostId, result);
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

  /**
   * Calls `listener` with the diff of a review target each time it changes on the host's disk
   * (phase 11); the host keeps watching while someone listens. Returns the function that stops.
   */
  watchChanges(
    hostId: string,
    target: string,
    listener: (update: ChangesUpdated) => void,
  ): () => void {
    return this.link.watchChanges(hostId, target, listener);
  }

  /**
   * Asks a host what the setup checklist reads: its hooks and its projects, at connect. GitHub runs
   * `gh auth status` on the host, so it is asked only with `github` (the Setup screen, the GitHub
   * panel); what it said last stays until then.
   */
  refreshSetup(
    hostId: string,
    options: { github?: boolean; connect?: boolean } = {},
  ): Promise<void> {
    return this.setupProbes.refresh(hostId, options);
  }

  /** Asks the host for its `host.info` again (after a change of its settings). */
  async reloadHostInfo(hostId: string): Promise<void> {
    const conn = this.link.connection(hostId);
    if (conn) await this.link.loadHostInfo(hostId, conn);
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

  dispose(): void {
    this.messaging.dispose();
    if (this.awayTimer) clearInterval(this.awayTimer);
    this.awayTimer = null;
    this.link.dispose();
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

  /** The session a move made, opened on its new host. */
  readonly openMovedSession = (hostId: string, sessionId: string): void => {
    this.select(hostId, sessionId);
    this.router.push({ name: "session", host: hostId, id: sessionId });
  };

  // -- internals ------------------------------------------------------------

  /** The frames of a host's connection, each to the slice that takes it (#1596). */
  private readonly routes: HostRoutes = {
    onSubscribed: (config, sessionId, result) =>
      this.stream.onSubscribed(config.id, sessionId, result),
    onEvent: (config, envelope) => this.stream.onEvent(config.id, envelope),
    onSummaries: (config, summaries) => this.summaries.apply(config.id, summaries),
    onCardUpdated: (config, card) => this.boardCards.onCard(config.id, card),
    onExternal: (config, frame) => this.external.onExternal(config.id, frame),
    onVaultRequest: (config, request) => void this.vaultApprovals.onRequest(config, request),
    onVaultUsed: (config, used) => {
      this.usage.recordUsed(config.id, used);
      this.keepUsage();
    },
    // Phase 19: a security warning stays on screen until closed, and the OS shows it too.
    onTeams: (config, frame) => this.teams.onFrame(config.id, frame),
    onMessagingAlert: (config, alert) => this.messaging.onLoopAlert(config.id, alert),
    onWatch: (config, frame) => this.prWatch.keep(config.id, frame.watch),
    onMessages: (config, frame) => this.messaging.onFrame(config.id, frame),
    onVaultAlert: (_config, alert) => {
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
    onRunUpdated: (config, run) => this.onRun(config.id, run),
    onRunEnvUpdated: (config, state) => this.runEnv.updated(config.id, state),
    onQuotaUpdated: (config, state) => this.quota.updated(config.id, state),
    onAccountUpdated: (config, state) => this.account.updated(config.id, state),
    onBudgetUpdated: (config, update) => this.budgets.onUpdated(config.id, update),
    onTerminal: (config, frame) => this.terminals.deliver(config.id, frame),
    onHistoryChanged: (config, change) => {
      for (const listener of this.historyListeners) listener(config.id, change);
    },
    onAskpass: (config, request) => void this.ssh.onAskpass(config.id, request),
  };

  /** What runs when a host comes online or its info is reloaded, in this order (#1596). */
  private readonly onlineSteps: readonly OnlineStep[] = [
    {
      run: ({ hostId, hostInfo }) =>
        this.updateHost(hostId, (h) => {
          // Back on the version it was updating to: the update is over.
          const done = h.daemonUpdate && hostInfo?.daemonVersion === h.daemonUpdate.target;
          if (done) this.hostUpdate.settled(hostId);
          return { ...h, hostInfo, infoAt: Date.now(), ...(done ? { daemonUpdate: null } : {}) };
        }),
    },
    // The setup checklist reads what this host has: its hooks, GitHub, projects.
    { run: ({ hostId, connect }) => void this.refreshSetup(hostId, { connect }) },
    // Issue #1344: a host that can say what happened while the app was closed is asked once.
    { gate: "activity", run: () => void this.activity.loadAway() },
    // ssh asks for passwords through the daemon: this app is who answers.
    { gate: "ssh", run: ({ conn }) => void conn.request("askpass.watch", {}).catch(() => null) },
    // Phase 21: this app carries the host's messages for the other hosts.
    { gate: "watch", run: ({ conn }) => void conn.request("watch.watch", {}).catch(() => null) },
    {
      gate: "teams",
      run: ({ hostId, conn }) => {
        void conn.request("teams.watch", {}).catch(() => null);
        // The sessions that belong to teams, so the workers' notifications can be folded.
        void conn
          .request("teams.list", {})
          .then((result) => {
            for (const team of result.teams) this.summaries.rememberTeam(hostId, team);
          })
          .catch(() => null);
      },
    },
    {
      gate: "messaging",
      run: ({ conn }) => {
        void conn.request("messages.watch", {}).catch(() => null);
        this.messaging.startPeersSync();
      },
    },
    // Phase 19: the daemon decides a request with the rules the app hands it.
    { gate: "actions", run: ({ hostId, conn }) => this.vaultRules.onConnect(hostId, conn) },
    { run: ({ hostId }) => void this.health.check(hostId) },
    // Not awaited, as the health check: a reload of the host's info never waits on the offer.
    {
      gate: FEATURE_RESUME_OFFER,
      run: ({ hostId, conn }) => void this.sessions.offerResume(hostId, conn),
    },
    {
      gate: "costs",
      awaited: true,
      run: async ({ hostId, conn }) => {
        const list = await conn.request("budget.list", {}).catch(() => null);
        if (list) this.budgets.replace(hostId, list.budgets);
      },
    },
  ];

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
      void this.link.loadHostInfo(hostId, conn, true);
      // Daemons before phase 7 have no quota: quietly nothing.
      void conn.request("quota.get", {}).then(
        (state) => this.quota.updated(hostId, state),
        () => {},
      );
    }
    if (status !== "online") this.terminals.tellOffline(hostId);
    if (status === "connecting") {
      this.stream.dropPartialText(hostId);
      // The cards that waited on the old connection leave the queue: the new one never saw them.
      // The deny may not reach the daemon; it ends the request at its own deadline.
      this.vaultApprovals.hostGone(hostId);
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

  /** A secret of the vault for a use the app itself starts (ssh); see `VaultApprovalsSlice.secretFor`. */
  vaultSecretFor(
    hostId: string,
    secretId: string,
    purpose: string,
  ): Promise<{ ok: true; value: string } | { ok: false; code: DeliveryRefusal }> {
    return this.vaultApprovals.secretFor(hostId, secretId, purpose);
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
  /** The machine's dialogs, clipboard, log file and a local host's files (#1596). */
  readonly system: SystemSlice;
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

  private onRun(hostId: string, run: WorkflowRun): void {
    this.update({ runs: { ...this.state.runs, [sessionKey(hostId, run.id)]: run } });
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
