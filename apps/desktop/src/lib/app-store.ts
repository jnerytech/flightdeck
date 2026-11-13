import type {
  ChangesUpdated,
  CommandPayload,
  CommandResults,
  HistoryChanged,
  SessionRecap,
  WorkflowRun,
} from "@flightdeck/protocol";
import { z } from "zod";
import { WORKSPACE_KEY, Workspace } from "@/features/shell/workspace.ts";
import { isInside, nullOnError, readStored } from "@/shared/lib/index.ts";
import { sameNotice } from "../app/notice-lifetime.ts";
import { type AssistantController, wireAssistant } from "../features/assistant/index.ts";
import { type BudgetsSlice, localDay, wireBudgets } from "../features/costs/index.ts";
import { HostLink, HostTabs, loadHosts, RequestError, saveHosts } from "../features/hosts/index.ts";
import { type InboxSlice, wireInbox } from "../features/inbox/index.ts";
import { type PersonasSlice, wirePersonas } from "../features/personas/index.ts";
import { ProjectKeys, type WorktreeFilter } from "../features/projects/index.ts";
import { SessionViews, sessionKey } from "../features/sessions/index.ts";
import { type SnippetsSlice, wireSnippets } from "../features/snippets/index.ts";
import type { Navigation, Tabs } from "../features/tabs/tabs.ts";
import { SessionMover } from "../features/teleport/teleport.ts";
import { type TerminalsSlice, wireTerminals } from "../features/terminal/index.ts";
import type { DeliveryRefusal } from "../features/vault/index.ts";
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
import {
  composeHosts,
  composeLinkHandlers,
  type HostSlices,
  type LinkHandlers,
} from "./compose/hosts.ts";
import { composeLifecycle, type Lifecycle } from "./compose/lifecycle.ts";
import { composeShell, type ShellSlices } from "./compose/shell.ts";
import { composeVault, type VaultSlices } from "./compose/vault.ts";
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

const isRun = (value: unknown): value is WorkflowRun =>
  typeof value === "object" && value !== null && "workflowName" in value && "steps" in value;

/** The window kept by the last run; nothing (a fresh window) when it is missing or unreadable. */
function storedWorkspace(storage: Platform["storage"]): unknown {
  // `Workspace.restore` checks the shape area by area, so anything that is JSON passes here.
  return readStored(storage, WORKSPACE_KEY, z.unknown(), null);
}

export { PALETTE_RECENTS_KEY } from "@/features/palette/palette-store.ts";

export { sessionKey };

const REAL_TIMERS = {
  setTimeout: (fn: () => void, ms: number): unknown => setTimeout(fn, ms),
  clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function describeError(error: unknown): string {
  return error instanceof RequestError ? `${error.code}: ${error.message}` : String(error);
}

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
  private noticeSeq = 0;
  private readonly historyListeners = new Set<(hostId: string, change: HistoryChanged) => void>();

  /** The spending limits of each host (phase 8, #1596). */
  readonly budgets: BudgetsSlice;
  /** The personas a session can take on, the hosts' and the app's (phase 20, #1596). */
  readonly personas: PersonasSlice;
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
        searchTimeoutMs: options.searchTimeoutMs,
        timers: options.timers ?? REAL_TIMERS,
        showSession: (hostId, sessionId) =>
          this.router.push({ name: "session", host: hostId, id: sessionId }),
        settleVault: (requestId, answer) => this.vaultApprovals.settle(requestId, answer),
        backgroundChanged: (hostId, list) => this.background.changed(hostId, list),
        webhookFeed: () => this.webhookFeed,
        notify: (...args) => this.inbox.notify(...args),
        copyText: (text) => this.system.copyText(text),
        projectOf: (hostId, cwd) => this.sessionProject(hostId, cwd),
        shown: () => this.shownSessions(),
        later: (fn, ms) => void this.later(fn, ms),
        respondTo: (hostId, requestId, decision) =>
          void this.respondTo(hostId, requestId, decision),
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
        relay: (request) => this.relayWebhook(request),
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
    this.budgets = wireBudgets(this.kernel, {
      feed: (host, label, percent, limit) => this.webhookFeed.budget(host, label, percent, limit),
      notify: (notification, route, source) =>
        this.inbox.notify(notification, route, undefined, source),
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
    this.assistant = wireAssistant(this.kernel, {
      storage: platform.storage,
      api: platform.assistant,
      language: () => this.i18n.lang,
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
      nextNoticeId: () => ++this.noticeSeq,
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

  init(): Promise<void> {
    return this.lifecycle.init();
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
