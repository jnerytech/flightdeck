import { SystemSlice } from "@/features/shell/system.ts";
import { type AccountSlice, wireAccount } from "../../features/account/index.ts";
import { type BackgroundSlice, wireBackground } from "../../features/background/index.ts";
import { BoardCardsSlice } from "../../features/board/index.ts";
import {
  type HealthSlice,
  type HostConfig,
  type HostLink,
  HostRosterSlice,
  type HostUpdateSlice,
  wireHealth,
  wireHostUpdate,
} from "../../features/hosts/index.ts";
import type { InboxSlice } from "../../features/inbox/index.ts";
import { type MessagingSlice, wireMessaging } from "../../features/messaging/index.ts";
import { type ProjectsSlice, wireProjects } from "../../features/projects/index.ts";
import { type QuotaSlice, wireQuota } from "../../features/quota/index.ts";
import { RunEnvSlice } from "../../features/runenv/store.ts";
import { type SummariesSlice, sessionKey } from "../../features/sessions/index.ts";
import { SetupProbes, SetupSettings } from "../../features/setup/index.ts";
import { type SshSlice, wireSsh } from "../../features/ssh/index.ts";
import { TeamsSlice } from "../../features/teams/store.ts";
import { isLocalUrl } from "../../features/terminal/terminal.ts";
import type { VaultApprovalsSlice } from "../../features/vault/index.ts";
import { type WatchSlice, wireWatch } from "../../features/watch/index.ts";
import type { WebhookFeed } from "../../features/webhook/webhook-feed.ts";
import type { Platform } from "../../platform/types.ts";
import type { AppState, HostView } from "../app-state.ts";
import type { AppKernel } from "../kernel.ts";
import { hasFeature } from "../version.ts";

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
