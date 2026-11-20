import type {
  ChangesUpdated,
  CommandPayload,
  CommandResults,
  HistoryChanged,
  SessionRecap,
  WorkflowRun,
} from "@flightdeck/protocol";
import { type ReleaseNotesResult, releaseNotes } from "@/features/appupdate/index.ts";
import { sessionRecap } from "@/features/summary/index.ts";
import type { Workspace } from "@/features/tabs/index.ts";
import { relayWebhook } from "@/features/webhook/index.ts";
import { isInside, nullOnError } from "@/shared/lib/index.ts";
import { Clock } from "../app/clock.ts";
import {
  composeHosts,
  composeLinkHandlers,
  type HostSlices,
  type LinkHandlers,
} from "../app/compose/hosts.ts";
import { composeLifecycle, type Lifecycle } from "../app/compose/lifecycle.ts";
import { composeShell, type ShellSlices } from "../app/compose/shell.ts";
import { composeVault, type VaultSlices } from "../app/compose/vault.ts";
import { describeError, Notices } from "../app/notices.ts";
import { TabWindow } from "../app/tab-window.ts";
import { type ApprovalSlice, wireApproval } from "../features/approval/index.ts";
import { type AssistantController, wireAssistant } from "../features/assistant/index.ts";
import { type BudgetsSlice, wireBudgets } from "../features/costs/index.ts";
import {
  HostCommands,
  HostLink,
  type HostTabs,
  RequestError,
  restoreKeptTabs,
  saveHosts,
  syncHostIndex,
} from "../features/hosts/index.ts";
import { type InboxSlice, wireInbox } from "../features/inbox/index.ts";
import type { Answer } from "../features/needs-you/index.ts";
import { type PersonasSlice, wirePersonas } from "../features/personas/index.ts";
import { ProjectKeys, type WorktreeFilter } from "../features/projects/index.ts";
import {
  fillComposer,
  SessionViews,
  sessionKey,
  takeComposerFill,
} from "../features/sessions/index.ts";
import { type SnippetsSlice, wireSnippets } from "../features/snippets/index.ts";
import type { Navigation, Tabs } from "../features/tabs/tabs.ts";
import { SessionMover } from "../features/teleport/teleport.ts";
import { type TerminalsSlice, wireTerminals } from "../features/terminal/index.ts";
import type { DeliveryRefusal } from "../features/vault/index.ts";
import { I18n } from "../i18n/index.ts";
import type { Platform } from "../platform/types.ts";
import type { AppState, AppStoreOptions, GateRef, HostView } from "./app-state.ts";
import { initialAppState, needsYou } from "./app-state.ts";
import type { AppKernel, HostCommandOptions, HostCommandType, HostResult } from "./kernel.ts";

export type { ReleaseNotesResult } from "@/features/appupdate/index.ts";
/** The state's types and pure functions live in `app-state.ts`; screens import them from here until each binds its slice (#1596). */
export type {
  AppState,
  HistoryFilter,
  HostView,
  NeedsYouState,
  Notice,
  PendingItem,
  SidebarSession,
} from "./app-state.ts";
export { HISTORY_PAGE, needsYou } from "./app-state.ts";
export type { HostResult } from "./kernel.ts";

const isRun = (value: unknown): value is WorkflowRun =>
  typeof value === "object" && value !== null && "workflowName" in value && "steps" in value;

export { PALETTE_RECENTS_KEY } from "@/features/palette/palette-store.ts";

export { sessionKey };

/**
 * The slices each composition module builds are the store's fields: the constructor assigns them
 * (`Object.assign`), and the merged interface gives them their types (#2376).
 */
export interface AppStore extends ShellSlices, HostSlices, VaultSlices {}

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
    onStatus: (hostId, conn, status) => this.handlers.onStatus(hostId, conn, status),
    // Read at connect and at load: the handlers are built at the end of the constructor.
    routes: () => this.handlers.routes,
    onlineSteps: () => this.handlers.onlineSteps,
    // Hiding the window to the tray can drop its taskbar badge: say it again.
    onWake: () => this.inbox.resendBadge(),
  });
  /** What the host link calls: its frames, its steps when a host comes online and its status (#2376). */
  private readonly handlers: LinkHandlers;
  /** The start and the stop of the app, with the timers they own (#2376). */
  private readonly lifecycle: Lifecycle;
  /** What time it is and how an instant is shown (the injected clock in tests). */
  private readonly time: Clock;
  /** The toasts and the error banner. */
  private readonly notices = new Notices({
    state: () => this.state,
    update: (patch) => this.update(patch),
    log: (level, source, message) => this.appLog.log(level, source, message),
  });
  /** What a command to a host comes to: a banner with a retry, or a refusal handed back (#1589). */
  private readonly hostCommands = new HostCommands({
    dispatch: (hostId, type, payload) => this.dispatch(hostId, type, payload),
    fail: (error, text, retry, answersCommand) => this.fail(error, text, retry, answersCommand),
  });
  private readonly historyListeners = new Set<(hostId: string, change: HistoryChanged) => void>();

  /** The spending limits of each host (phase 8, #1596). */
  readonly budgets: BudgetsSlice;
  /** The personas a session can take on, the hosts' and the app's (phase 20, #1596). */
  readonly personas: PersonasSlice;
  /** The saved commands and prompts, the hosts' and the app's own (phase 18, #1596). */
  readonly snippets: SnippetsSlice;
  /** This device's key per host and the proof of a high-risk allow (#3439). */
  readonly approval: ApprovalSlice;

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
    this.time = new Clock(options, () => this.i18n.lang);
    Object.assign(
      this,
      composeShell(this.kernel, {
        platform,
        appUpdateIntervalMs: () => this.options.appUpdateIntervalMs,
        updateHost: (hostId, change) => this.updateHost(hostId, change),
        formatTime: (iso) => this.formatTime(iso),
        secretValues: () => this.scan.values(),
        openSearch: () => this.history.openSearch(),
        searchTimeoutMs: options.searchTimeoutMs,
        timers: this.time.timers,
        showSession: (hostId, sessionId) =>
          this.router.push({ name: "session", host: hostId, id: sessionId }),
        settleVault: (requestId, answer) => this.vaultApprovals.settle(requestId, answer),
        backgroundChanged: (hostId, list) => this.background.changed(hostId, list),
        webhookFeed: () => this.webhookFeed,
        notify: (...args) => this.inbox.notify(...args),
        copyText: (text) => this.system.copyText(text),
        projectOf: (hostId, cwd) => this.sessionProject(hostId, cwd),
        shown: () => this.tabWindow.shownSessions(),
        later: (fn, ms) => this.later(fn, ms),
        respondTo: (hostId, requestId, decision) =>
          void this.respondTo(hostId, requestId, decision),
        prove: (hostId, answer, risk) => this.approval.prove(hostId, answer, risk),
        palette: {
          loadProjects: (hostId) => this.projectList.load(hostId),
          loadBoard: (hostId, projectId) => this.boardCards.load(hostId, projectId),
          loadSshTargets: (hostId) => this.ssh.loadTargets(hostId),
          loadPersonas: (hostId) => this.personas.load(hostId),
          listSnippets: (hostId) => nullOnError(this.dispatch(hostId, "snippets.list", {})),
          keepSnippets: (hostId, snippets) => this.snippets.keep(hostId, snippets),
          refreshHub: () => this.sessionLists.refresh(),
        },
      }),
    );
    Object.assign(
      this,
      composeHosts(this.kernel, {
        platform,
        link: this.link,
        updateHost: (hostId, change) => this.updateHost(hostId, change),
        persistHosts: () => this.persistHosts(),
        detach: (hostId) => {
          this.hostTabs.removeHost(hostId);
          this.vaultApprovals.hostGone(hostId);
          this.activity.forget(hostId);
          this.link.remove(hostId);
        },
        rememberToken: (token) => this.scan.rememberToken(token),
        hasSecret: (secretId) => this.vault.list().some((secret) => secret.id === secretId),
        secretFor: (hostId, secretId) => this.vaultApprovals.secretFor(hostId, secretId, "ssh"),
        showTerminal: (hostId, terminalId) =>
          this.hostTabs.open({ name: "terminal", host: hostId, terminalId }),
        notify: (...args) => this.inbox.notify(...args),
        webhookFeed: () => this.webhookFeed,
        rememberTeam: (hostId, team) => this.summaries.rememberTeam(hostId, team),
        describeError,
        daemonUpdateTimeoutMs: options.daemonUpdateTimeoutMs,
        peersSyncMs: options.peersSyncMs,
      }),
    );
    Object.assign(
      this,
      composeVault(this.kernel, {
        platform,
        options,
        notify: (...args) => this.inbox.notify(...args),
        keepUsage: () => this.keepUsage(),
        copyText: (text) => this.system.copyText(text),
        today: () => this.today(),
        keyOf: (hostId, project) => this.projectList.keyOf(hostId, project),
        relay: (request) => relayWebhook(this.kernel, request),
        recap: (hostId, claudeSessionId, extra) =>
          this.sessionRecap(hostId, claudeSessionId, extra),
        roiChanged: () => this.update({ roiRevision: this.state.roiRevision + 1 }),
      }),
    );
    this.personas = wirePersonas(this.kernel, {
      storage: platform.storage,
      language: () => this.i18n.lang,
    });
    this.snippets = wireSnippets(this.kernel, { storage: platform.storage });
    this.approval = wireApproval(this.kernel, { platform, lang: () => this.i18n.lang });
    this.budgets = wireBudgets(this.kernel, {
      feed: (host, label, percent, limit) => this.webhookFeed.budget(host, label, percent, limit),
      notify: (notification, route, source) =>
        this.inbox.notify(notification, route, undefined, source),
    });
    this.hostTabs = restoreKeptTabs(platform.storage, options.startRoute);
    this.router = this.hostTabs.router;
    this.tabWindow = new TabWindow({
      hostTabs: this.hostTabs,
      state: () => this.state,
      update: (patch) => this.update(patch),
      sessionViews: this.sessionViews,
      closeShell: (hostId, terminalId) =>
        void this.hostCommand(hostId, "terminal.close", { terminalId, kill: true }),
      uiHostId: () => this.uiModes.hostId(),
      translate: () => this.i18n.t,
      success: (text, link) => this.success(text, link),
    });
    this.hostTabs.onSwitch((left, to) => this.tabWindow.announceSwitch(left, to));
    this.hostTabs.subscribe(() => this.tabWindow.clearShownUnread());
    this.assistant = wireAssistant(this.kernel, {
      storage: platform.storage,
      api: platform.assistant,
      language: () => this.i18n.lang,
    });
    this.terminals = wireTerminals(this.kernel, {
      showTab: (hostId, terminalId) =>
        this.hostTabs.open({ name: "terminal", host: hostId, terminalId }),
      // The current host's areas, or another host's first one (a tab of the all-hosts row).
      areas: () => [...this.workspace.areas, ...this.hostTabs.groups().map((g) => g.tabs)],
      copyText: (text) => this.system.copyText(text),
      spawn: (program, args) => this.platform.terminal.open(program, args),
      describeError,
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
    this.i18n.subscribe(() => this.onLanguage());
    this.state = initialAppState(platform, {
      now: (options.now ?? Date.now)(),
      vaultUsage: this.usage.list(),
      clientList: this.clients.list(),
      clientOverrides: this.clients.overrides(),
    });
    this.handlers = composeLinkHandlers(this.kernel, {
      slices: () => this,
      link: () => this.link,
      updateHost: (hostId, change) => this.updateHost(hostId, change),
      nextNoticeId: this.notices.nextId,
      keepUsage: () => this.keepUsage(),
      onRun: (hostId, run) => this.onRun(hostId, run),
      historyChanged: (hostId, change) => {
        for (const listener of this.historyListeners) listener(hostId, change);
      },
      refreshSetup: (hostId, options) => this.refreshSetup(hostId, options),
    });
    this.lifecycle = composeLifecycle(this.kernel, {
      platform,
      slices: () => this,
      link: () => this.link,
      clientBudgetIntervalMs: () => this.options.clientBudgetIntervalMs,
    });
  }

  /** Phase 40: the AI assistant's preferences, keys state and the wand's requests. */
  readonly assistant: AssistantController;
  /** Where a wand with no provider sends the person: Settings, section Assistant (issue #162). */
  readonly openAssistantSettings = (): void =>
    this.router.push({ name: "settings", section: "assistant" });
  /** Issue #107: the view each session tab was on, and the page now on screen. */
  readonly sessionViews = new SessionViews();
  /** The project keys any screen has read, for one label per project everywhere (issue #881). */
  readonly projectKeys = new ProjectKeys();
  /** The notification center (the bell), the taskbar badge, the OS toast and the sound (#1596). */
  readonly inbox: InboxSlice;
  /** The teleport's channels and moves (#1596); the connection is read when a move asks. */
  readonly mover = new SessionMover((hostId) => this.link.connection(hostId));
  /** The terminals of every host: their commands, tabs, "Claude aqui" and the close that asks (#1596). */
  readonly terminals: TerminalsSlice;
  /** pt-BR or English, and the translator (phase 10). */
  readonly i18n: I18n;
  /** The screen in use and its history (phase 10). */
  readonly router: Navigation;
  /** Each host's own tabs and the shared screens (issue #644). */
  readonly hostTabs: HostTabs;
  /** What the window shows and what a tab change touches (#1589). */
  private readonly tabWindow: TabWindow;

  /** The current host's window (its tabs and split); an empty one with no host. */
  get workspace(): Workspace {
    return this.tabWindow.workspace;
  }

  /** The tabs in use: the shared ones while a shared tab is active or with no host, else the host's focused area. */
  get tabs(): Tabs {
    return this.tabWindow.tabs;
  }

  getState = (): AppState => this.state;

  /** Milliseconds now (injected in tests). */
  now(): number {
    return this.time.now();
  }

  /** Today as `YYYY-MM-DD`, in this machine's time zone unless injected. */
  today(): string {
    return this.time.today();
  }

  /** HH:MM of an instant, in this machine's time zone unless injected. */
  formatTime(iso: string): string {
    return this.time.formatTime(iso);
  }

  /** Date and time of an instant in local time, in the app's language (phase 10). */
  formatDateTime(iso: string): string {
    return this.time.formatDateTime(iso);
  }

  /** A list's short time: HH:MM today, the day and month before (phase 10). */
  formatWhen(iso: string): string {
    return this.time.formatWhen(iso);
  }

  getLatency = (hostId: string): number | null => this.link.getLatency(hostId);

  /** For the one component that shows a latency; a heartbeat never reaches `subscribe`. */
  subscribeLatency = (listener: () => void): (() => void) => this.link.subscribeLatency(listener);

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  init(): Promise<void> {
    return this.lifecycle.init();
  }

  /** Starts the poll the GitHub panel runs while a sign-in waits; the returned function stops it. */
  githubTicker(tick: () => void): () => void {
    return this.time.githubTicker(tick);
  }

  /** Hands `text` to the message box of the session `key`; it waits there until the box takes it. */
  fillComposer(key: string, text: string): void {
    fillComposer(this.kernel, key, text);
  }

  /** The text waiting for the session's box, which is now taken; `null` when there is none. */
  takeComposerFill(key: string): string | null {
    return takeComposerFill(this.kernel, key);
  }

  /** The app's latest releases, read through the first online host that offers them (issue #125). */
  releaseNotes(): Promise<ReleaseNotesResult> {
    return releaseNotes(this.kernel);
  }

  /** Opens a web page (an issue, a PR) in the user's browser; anything but http(s) is refused. */
  openLink(url: string): void {
    if (/^https?:\/\//i.test(url)) void this.platform.openExternal(url);
  }

  /** `flightdeck://` links opened from outside the app (OS deep link or second instance). */
  onDeepLink(handler: (url: string) => void): () => void {
    return this.platform.onDeepLink(handler);
  }

  /** The host the switcher shows: the active tab's, or the last one used on a shared tab. */
  activeHostId(): string | null {
    return this.tabWindow.activeHostId();
  }

  /** A new tab; the host tabs choose where (`HostTabs.openNew`). */
  openNewTab(): void {
    this.tabWindow.openNewTab();
  }

  /** Picks the checkout the board and the Sessions list narrow to, or clears it. */
  setWorktreeFilter(filter: WorktreeFilter | null): void {
    this.update({ worktreeFilter: filter });
  }

  /** Closes a tab; a terminal's waits in `closingTerminal` for detach or end. */
  closeTab(area: Tabs, tabId: string): void {
    this.tabWindow.closeTab(area, tabId);
  }

  /**
   * Sends a project, board or card command to a host. Cards in the answer go to `cards`; errors
   * go to the banner and give `null`.
   */
  hostCommand<T extends HostCommandType>(
    hostId: string,
    type: T,
    payload: CommandPayload<T>,
    options: HostCommandOptions = {},
  ): Promise<CommandResults[T] | null> {
    return this.hostCommands.command(hostId, type, payload, options);
  }

  /** How many requests to the host were sent and not answered yet (0 for an unknown host). */
  hostInFlight(hostId: string): number {
    return this.link.connection(hostId)?.inFlight ?? 0;
  }

  /**
   * Like `hostCommand`, but a refusal comes back with its code and message instead of going to
   * the banner: for screens that explain it themselves (a file that changed, a merge conflict).
   */
  hostRequest<T extends HostCommandType>(
    hostId: string,
    type: T,
    payload: CommandPayload<T>,
  ): Promise<HostResult<CommandResults[T]>> {
    return this.hostCommands.request(hostId, type, payload);
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
    return this.time.later(fn, ms);
  }

  /** Transcripts growing on any host (live reader); returns the function that stops it. */
  onHistoryChanged(listener: (hostId: string, change: HistoryChanged) => void): () => void {
    this.historyListeners.add(listener);
    return () => this.historyListeners.delete(listener);
  }

  reportError(message: string): void {
    this.notices.reportError(message);
  }

  clearError(): void {
    this.notices.clearError();
  }

  /** A short success toast (copied, saved, started…), already translated. */
  success(text: string, link?: { label: string; run: () => void }): void {
    this.notices.success(text, link);
  }

  /** A toast closed (or shown, for successes): it leaves the list. */
  dismissNotice(id: number): void {
    this.notices.dismiss(id);
  }

  private fail(error: unknown, text?: string, retry?: () => void, answersCommand = false): void {
    this.notices.fail(error, text, retry, answersCommand);
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
    this.lifecycle.dispose();
  }

  /** The session a move made, opened on its new host. */
  readonly openMovedSession = (hostId: string, sessionId: string): void => {
    this.subscriptions.select(hostId, sessionId);
    this.router.push({ name: "session", host: hostId, id: sessionId });
  };

  // -- internals ------------------------------------------------------------

  /** `hostId/projectId` of the project whose folder holds `cwd`, if any. */
  private sessionProject(hostId: string, cwd: string | null | undefined): string | undefined {
    const project = cwd
      ? (this.state.projects[hostId] ?? []).find((p) => isInside(cwd, p.path))
      : undefined;
    return project ? `${hostId}/${project.id}` : undefined;
  }

  /** A secret of the vault for a use the app itself starts (ssh); see `VaultApprovalsSlice.secretFor`. */
  vaultSecretFor(
    hostId: string,
    secretId: string,
    purpose: string,
  ): Promise<{ ok: true; value: string } | { ok: false; code: DeliveryRefusal }> {
    return this.vaultApprovals.secretFor(hostId, secretId, purpose);
  }

  private keepUsage(): void {
    this.update({ vaultUsage: this.usage.list() });
  }

  /** Phase 30: the summary of a session of a host; null when the host cannot give one. */
  sessionRecap(
    hostId: string,
    claudeSessionId: string,
    extra: { question?: string } = {},
  ): Promise<SessionRecap | null> {
    return sessionRecap(this.kernel, hostId, claudeSessionId, extra);
  }

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
    syncHostIndex(this.platform.hostIndex, this.state.hosts);
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
