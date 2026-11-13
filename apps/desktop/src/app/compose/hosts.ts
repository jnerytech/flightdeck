import type { HistoryChanged, WorkflowRun } from "@flightdeck/protocol";
import { FEATURE_RESUME_OFFER } from "@flightdeck/protocol";
import { SystemSlice } from "@/features/shell/system.ts";
import { type AccountSlice, wireAccount } from "../../features/account/index.ts";
import type { ActivitySlice } from "../../features/activity/index.ts";
import { type BackgroundSlice, wireBackground } from "../../features/background/index.ts";
import { BoardCardsSlice } from "../../features/board/index.ts";
import type { BudgetsSlice } from "../../features/costs/index.ts";
import {
  type ConnectionStatus,
  type HealthSlice,
  type HostConfig,
  type HostConnection,
  type HostLink,
  HostRosterSlice,
  type HostRoutes,
  type HostUpdateSlice,
  type OnlineStep,
  statusLine,
  wireHealth,
  wireHostUpdate,
} from "../../features/hosts/index.ts";
import type { InboxSlice } from "../../features/inbox/index.ts";
import { type MessagingSlice, wireMessaging } from "../../features/messaging/index.ts";
import { type ProjectsSlice, wireProjects } from "../../features/projects/index.ts";
import { type QuotaSlice, wireQuota } from "../../features/quota/index.ts";
import { RunEnvSlice } from "../../features/runenv/store.ts";
import {
  type ExternalSessionsSlice,
  type SessionStreamSlice,
  type SessionsSlice,
  type SummariesSlice,
  sessionKey,
} from "../../features/sessions/index.ts";
import { SetupProbes, SetupSettings } from "../../features/setup/index.ts";
import { type SshSlice, wireSsh } from "../../features/ssh/index.ts";
import { TeamsSlice } from "../../features/teams/store.ts";
import type { TerminalsSlice } from "../../features/terminal/index.ts";
import { isLocalUrl } from "../../features/terminal/terminal.ts";
import type {
  VaultApprovalsSlice,
  VaultRulesSlice,
  VaultUsageLog,
} from "../../features/vault/index.ts";
import { type WatchSlice, wireWatch } from "../../features/watch/index.ts";
import type { WebhookFeed } from "../../features/webhook/webhook-feed.ts";
import type { AppState, HostView, Notice } from "../../lib/app-state.ts";
import type { AppKernel } from "../../lib/kernel.ts";
import { hasFeature } from "../../lib/version.ts";
import type { Platform } from "../../platform/types.ts";
import type { AppLog } from "../app-log.ts";

/** A host the app lists before its first connection answers. */
export const newHostView = (config: HostConfig): HostView => ({
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

/** The hosts the app has and what the setup, the board and the sessions ask of them (#2376). */
export interface HostSlices {
  /** The machine's dialogs, clipboard, log file and a local host's files (#1596). */
  readonly system: SystemSlice;
  /** Which hosts the app has: adding, removing, naming, pairing again and reconnecting (#1596). */
  readonly roster: HostRosterSlice;
  /** What each host's dependencies and doctor say (#1596). */
  readonly health: HealthSlice;
  /** A host's daemon update: asked for, checked, and watched until it comes back (#1596). */
  readonly hostUpdate: HostUpdateSlice;
  /** The ssh destinos of the hosts, the prompts ssh raises and its terminals (phase 15, #1596). */
  readonly ssh: SshSlice;
  /** Claude Code's background sessions of each host (phase 27, #1596). */
  readonly background: BackgroundSlice;
  /** The plan quota of each host, its pause guard and the notices it raises (#1596). */
  readonly quota: QuotaSlice;
  /** The Claude account each host is signed in to (phase 34, #1596). */
  readonly account: AccountSlice;
  /** A card's run environment: run.yaml, trust, start and stop (`features/runenv/store.ts`). */
  readonly runEnv: RunEnvSlice;
  /** The projects each host lists: the list, a project's key and its PR provider (#1596). */
  readonly projectList: ProjectsSlice;
  /** The setup checklist: hidden or not, and whether a test notification ever showed. */
  readonly setup: SetupSettings;
  /** #1596: what the setup checklist asked each host. */
  readonly setupProbes: SetupProbes;
  /** The board cards the app has seen: sent, answered with, or loaded with a board (#1596). */
  readonly boardCards: BoardCardsSlice;
  /** The PR watch of the cards: each card's watch, its commands and the screen a PR link opens (#1596). */
  readonly prWatch: WatchSlice;
  /** The messages between sessions: the loops a host paused (phase 21, #1596). */
  readonly messaging: MessagingSlice;
  /** The teams of the hosts: their changes, told and notified (`features/teams/store.ts`). */
  readonly teams: TeamsSlice;
}

/** What the host slices read from the rest of the store; each is read when a slice asks, so a slice built later is fine. */
interface HostsDeps {
  platform: Platform;
  /** The connections to the hosts. */
  link: HostLink;
  /** Changes one host's view in the state. */
  updateHost: (hostId: string, change: (host: HostView) => HostView) => void;
  /** Writes the hosts list to the storage. */
  persistHosts: () => void;
  /** What a removed host leaves behind: its tabs, its vault approvals and its connection. */
  detach: (hostId: string) => void;
  /** A host's token, so the log and the screens never show it. */
  rememberToken: (token: string) => void;
  /** Whether the vault holds that secret. */
  hasSecret: (secretId: string) => boolean;
  /** A secret of the vault for an ssh use the app itself starts. */
  secretFor: (hostId: string, secretId: string) => ReturnType<VaultApprovalsSlice["secretFor"]>;
  /** Opens a terminal tab. */
  showTerminal: (hostId: string, terminalId: string) => void;
  /** The notification center (the bell), the taskbar badge and the OS toast. */
  notify: InboxSlice["notify"];
  /** The webhook feed that tells a card's PR watch. */
  webhookFeed: () => WebhookFeed;
  /** The session summaries that fold a team's workers. */
  rememberTeam: SummariesSlice["rememberTeam"];
  /** A refusal or a failure as text. */
  describeError: (error: unknown) => string;
  /** The daemon update's timeout, in milliseconds (tests set it). */
  daemonUpdateTimeoutMs: number | undefined;
  /** The delay between the messaging peers' syncs (tests set it). */
  peersSyncMs: number | undefined;
}

/**
 * Builds the host slices. Every slice is built through its own domain's entry; the store keeps
 * only what it owns (#2376).
 */
export function composeHosts(kernel: AppKernel<AppState>, deps: HostsDeps): HostSlices {
  const { platform } = deps;
  const projectList = wireProjects(kernel);
  const health = wireHealth(kernel);
  const account = wireAccount(kernel);
  const hostUpdate = wireHostUpdate(kernel, {
    patch: (hostId, patch) => deps.updateHost(hostId, (h) => ({ ...h, ...patch })),
    open: (hostId) => deps.link.open(hostId),
    describeError: deps.describeError,
    timeoutMs: deps.daemonUpdateTimeoutMs,
  });
  return {
    system: new SystemSlice({
      platform,
      localHost: (hostId) => {
        const host = kernel.state().hosts.find((h) => h.id === hostId);
        return host !== undefined && isLocalUrl(host.url);
      },
      fail: (error, text) => kernel.fail(error, text),
      success: (text) => kernel.success(text),
      copiedText: () => kernel.t()("toast.copied"),
    }),
    roster: new HostRosterSlice({
      secrets: platform.secrets,
      hosts: () => kernel.state().hosts,
      list: (config) => kernel.update({ hosts: [...kernel.state().hosts, newHostView(config)] }),
      persist: deps.persistHosts,
      connect: (config, token) => deps.link.connect(config, token),
      stop: (hostId) => deps.link.stop(hostId),
      detach: deps.detach,
      forget: (hostId) => {
        const state = kernel.state();
        const ofOthers = <T>(all: Record<string, T>) =>
          Object.fromEntries(Object.entries(all).filter(([key]) => !key.startsWith(`${hostId}/`)));
        const { [hostId]: _gone, ...setupProbes } = state.setupProbes;
        kernel.update({
          hosts: state.hosts.filter((h) => h.id !== hostId),
          sessions: ofOthers(state.sessions),
          cards: ofOthers(state.cards),
          selected: state.selected?.hostId === hostId ? null : state.selected,
          setupProbes,
        });
        hostUpdate.forget(hostId);
        health.forget(hostId);
        account.forget(hostId);
      },
      setName: (hostId, name) => deps.updateHost(hostId, (h) => ({ ...h, name })),
      rememberToken: deps.rememberToken,
      addRoot: (hostId, path) => kernel.hostCommand(hostId, "roots.add", { path, confirm: true }),
      setAllowedRoots: (hostId, allowedRoots) => {
        const conn = kernel.connection(hostId);
        if (conn?.info) conn.info = { ...conn.info, allowedRoots };
        deps.updateHost(hostId, (h) => (h.info ? { ...h, info: { ...h.info, allowedRoots } } : h));
      },
      success: (text) => kernel.success(text),
      t: () => kernel.t(),
    }),
    health,
    hostUpdate,
    ssh: wireSsh(kernel, {
      hasSecret: deps.hasSecret,
      secretFor: deps.secretFor,
    }),
    background: wireBackground(kernel, { showTerminal: deps.showTerminal }),
    quota: wireQuota(kernel, {
      notify: (notice, hostId) =>
        deps.notify(notice, { name: "host", host: hostId }, undefined, {
          event: "budget-quota",
          hostId,
        }),
    }),
    account,
    runEnv: new RunEnvSlice({
      state: () => kernel.state(),
      update: (patch) => kernel.update(patch),
      key: sessionKey,
      config: (hostId, projectId) => kernel.hostCommand(hostId, "runenv.config", { projectId }),
      trust: (hostId, projectId, hash) =>
        kernel.hostCommand(hostId, "runenv.trust", { projectId, hash }),
      start: (hostId, cardId) => kernel.hostCommand(hostId, "runenv.start", { cardId }),
      stop: (hostId, cardId) => kernel.hostCommand(hostId, "runenv.stop", { cardId }),
    }),
    projectList,
    setup: new SetupSettings(platform.storage),
    setupProbes: new SetupProbes({
      host: (hostId) => {
        const host = kernel.state().hosts.find((h) => h.id === hostId);
        return host && { status: host.status, features: host.hostInfo?.features };
      },
      projectsRead: (hostId) => kernel.state().projects[hostId] !== undefined,
      request: (hostId, type, payload) => kernel.hostRequest(hostId, type, payload),
      rememberProjects: (hostId, projects) => projectList.remember(hostId, projects),
      probes: () => kernel.state().setupProbes,
      setProbes: (setupProbes) => kernel.update({ setupProbes }),
    }),
    // Built here, not in a board wire: a wire importing the kernel would join its import cycle (#1624).
    boardCards: new BoardCardsSlice({
      cards: () => kernel.state().cards,
      setCards: (cards) => kernel.update({ cards }),
      connection: (hostId) => kernel.connection(hostId),
      notify: (notification, route, fallbackUrl) => deps.notify(notification, route, fallbackUrl),
      t: () => kernel.t(),
    }),
    prWatch: wireWatch(kernel, {
      feed: (host, title, before, watch) => deps.webhookFeed().watch(host, title, before, watch),
      notify: (notification, route, fallbackUrl, source) =>
        deps.notify(notification, route, fallbackUrl, source),
    }),
    messaging: wireMessaging(kernel, {
      notify: (notification) => deps.notify(notification),
      // Phase 21: only an online host with messaging takes part in the relay.
      relayHosts: () =>
        kernel.state().hosts.map((h) => ({
          id: h.id,
          hostName: h.hostInfo?.hostName ?? "",
          online: h.status === "online" && hasFeature(h.hostInfo?.features, "messaging", false),
        })),
      peersSyncMs: deps.peersSyncMs,
    }),
    teams: new TeamsSlice({
      remember: deps.rememberTeam,
      notify: (notification, route) => deps.notify(notification, route),
      t: () => kernel.t(),
    }),
  };
}

/** The slices the host link's frames and online steps hand their work to. */
interface LinkSlices
  extends Pick<
    HostSlices,
    | "health"
    | "hostUpdate"
    | "ssh"
    | "quota"
    | "account"
    | "runEnv"
    | "boardCards"
    | "prWatch"
    | "messaging"
    | "teams"
  > {
  readonly stream: SessionStreamSlice;
  readonly summaries: SummariesSlice;
  readonly external: ExternalSessionsSlice;
  readonly sessions: SessionsSlice;
  readonly activity: ActivitySlice;
  readonly vaultApprovals: VaultApprovalsSlice;
  readonly vaultRules: VaultRulesSlice;
  readonly usage: VaultUsageLog;
  readonly budgets: BudgetsSlice;
  readonly terminals: TerminalsSlice;
  readonly inbox: InboxSlice;
  readonly appLog: AppLog;
}

/** What the host link's handlers read from the store besides the slices. */
interface LinkHandlerDeps {
  /** The slices, read when a frame arrives: all of them are built by then. */
  slices: () => LinkSlices;
  /** The connections to the hosts. */
  link: () => HostLink;
  /** Changes one host's view in the state. */
  updateHost: (hostId: string, change: (host: HostView) => HostView) => void;
  /** The id of the next notice. */
  nextNoticeId: () => number;
  /** Tells the state what the vault was asked, after the log changed. */
  keepUsage: () => void;
  /** A workflow run a host reports. */
  onRun: (hostId: string, run: WorkflowRun) => void;
  /** Tells the listeners of the history that a host's changed. */
  historyChanged: (hostId: string, change: HistoryChanged) => void;
  /** Asks the host what the setup checklist reads. */
  refreshSetup: (hostId: string, options: { connect: boolean }) => Promise<void>;
}

/** What a host's connection hands the store: the frames, the steps when it comes online and its status. */
export interface LinkHandlers {
  readonly routes: HostRoutes;
  readonly onlineSteps: readonly OnlineStep[];
  readonly onStatus: (hostId: string, conn: HostConnection, status: ConnectionStatus) => void;
}

/**
 * Builds what the host link calls: each frame goes to the slice that takes it (#1596), what runs
 * when a host comes online or its info is reloaded, in order, and the host's new status (#2376).
 */
export function composeLinkHandlers(
  kernel: AppKernel<AppState>,
  deps: LinkHandlerDeps,
): LinkHandlers {
  const slices = deps.slices;
  const routes: HostRoutes = {
    onSubscribed: (config, sessionId, result) =>
      slices().stream.onSubscribed(config.id, sessionId, result),
    onEvent: (config, envelope) => slices().stream.onEvent(config.id, envelope),
    onSummaries: (config, summaries) => slices().summaries.apply(config.id, summaries),
    onCardUpdated: (config, card) => slices().boardCards.onCard(config.id, card),
    onExternal: (config, frame) => slices().external.onExternal(config.id, frame),
    onVaultRequest: (config, request) => void slices().vaultApprovals.onRequest(config, request),
    onVaultUsed: (config, used) => {
      slices().usage.recordUsed(config.id, used);
      deps.keepUsage();
    },
    // Phase 19: a security warning stays on screen until closed, and the OS shows it too.
    onTeams: (config, frame) => slices().teams.onFrame(config.id, frame),
    onMessagingAlert: (config, alert) => slices().messaging.onLoopAlert(config.id, alert),
    onWatch: (config, frame) => slices().prWatch.keep(config.id, frame.watch),
    onMessages: (config, frame) => slices().messaging.onFrame(config.id, frame),
    onVaultAlert: (_config, alert) => {
      const notice: Notice = {
        id: deps.nextNoticeId(),
        kind: "error",
        code: "vault_alert",
        text: alert.message,
      };
      kernel.update({ notices: [...kernel.state().notices, notice] });
      slices().inbox.notify({
        title: kernel.t()("vaultAudit.alertTitle"),
        body: alert.message,
      });
    },
    onRunUpdated: (config, run) => deps.onRun(config.id, run),
    onRunEnvUpdated: (config, state) => slices().runEnv.updated(config.id, state),
    onQuotaUpdated: (config, state) => slices().quota.updated(config.id, state),
    onAccountUpdated: (config, state) => slices().account.updated(config.id, state),
    onBudgetUpdated: (config, update) => slices().budgets.onUpdated(config.id, update),
    onTerminal: (config, frame) => slices().terminals.deliver(config.id, frame),
    onHistoryChanged: (config, change) => deps.historyChanged(config.id, change),
    onAskpass: (config, request) => void slices().ssh.onAskpass(config.id, request),
  };
  const onlineSteps: readonly OnlineStep[] = [
    {
      run: ({ hostId, hostInfo }) =>
        deps.updateHost(hostId, (h) => {
          // Back on the version it was updating to: the update is over.
          const done = h.daemonUpdate && hostInfo?.daemonVersion === h.daemonUpdate.target;
          if (done) slices().hostUpdate.settled(hostId);
          return { ...h, hostInfo, infoAt: Date.now(), ...(done ? { daemonUpdate: null } : {}) };
        }),
    },
    // The setup checklist reads what this host has: its hooks, GitHub, projects.
    { run: ({ hostId, connect }) => void deps.refreshSetup(hostId, { connect }) },
    // Issue #1344: a host that can say what happened while the app was closed is asked once.
    { gate: "activity", run: () => void slices().activity.loadAway() },
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
            for (const team of result.teams) slices().summaries.rememberTeam(hostId, team);
          })
          .catch(() => null);
      },
    },
    {
      gate: "messaging",
      run: ({ conn }) => {
        void conn.request("messages.watch", {}).catch(() => null);
        slices().messaging.startPeersSync();
      },
    },
    // Phase 19: the daemon decides a request with the rules the app hands it.
    { gate: "actions", run: ({ hostId, conn }) => slices().vaultRules.onConnect(hostId, conn) },
    { run: ({ hostId }) => void slices().health.check(hostId) },
    // Not awaited, as the health check: a reload of the host's info never waits on the offer.
    {
      gate: FEATURE_RESUME_OFFER,
      run: ({ hostId, conn }) => void slices().sessions.offerResume(hostId, conn),
    },
    {
      gate: "costs",
      awaited: true,
      run: async ({ hostId, conn }) => {
        const list = await conn.request("budget.list", {}).catch(() => null);
        if (list) slices().budgets.replace(hostId, list.budgets);
      },
    },
  ];
  const onStatus = (hostId: string, conn: HostConnection, status: ConnectionStatus): void => {
    const name = kernel.state().hosts.find((h) => h.id === hostId)?.name ?? hostId;
    const line = statusLine(name, status, conn.lastDrop);
    slices().appLog.log(line.level, "host", line.text);
    deps.updateHost(hostId, (h) => ({
      ...h,
      status,
      info: conn.info,
      incompatibility: conn.incompatibility,
      retry: conn.retry,
    }));
    if (status === "online") {
      void deps.link().loadHostInfo(hostId, conn, true);
      // Daemons before phase 7 have no quota: quietly nothing.
      void conn.request("quota.get", {}).then(
        (state) => slices().quota.updated(hostId, state),
        () => {},
      );
    }
    if (status !== "online") slices().terminals.tellOffline(hostId);
    if (status === "connecting") {
      slices().stream.dropPartialText(hostId);
      // The cards that waited on the old connection leave the queue: the new one never saw them.
      // The deny may not reach the daemon; it ends the request at its own deadline.
      slices().vaultApprovals.hostGone(hostId);
    }
  };
  return { routes, onlineSteps, onStatus };
}
