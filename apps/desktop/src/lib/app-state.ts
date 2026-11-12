/**
 * The app store's state and what its screens read from it (#1596): the types of the state, the
 * commands a host answers, and the pure functions over them. `app-store.ts` re-exports them, so a
 * screen imports from there until it binds its slice directly.
 */
import type {
  Card,
  CommandPayload,
  ExternalPermissionFrame,
  ExternalSession,
  HelloResult,
  HistorySessionSummary,
  HostInfoResult,
  PendingPermission,
  PermissionUpdate,
  PlainInfo,
  Project,
  ReleaseNote,
  RiskLevel,
  RunState,
  SessionMeta,
  SessionNameInfo,
  SessionRuntime,
  SessionStatus,
  SessionSummary,
  WatchInfo,
  WorkflowRun,
} from "@flightdeck/protocol";
import { basename } from "@/shared/lib/index.ts";
import type { AccountSliceState } from "../features/account/index.ts";
import type { ActivitySliceState } from "../features/activity/index.ts";
import type { AppUpdateState } from "../features/appupdate/index.ts";
import type { BackgroundSliceState } from "../features/background/index.ts";
import type { BudgetsSliceState, ClientBudgetsSliceState } from "../features/costs/index.ts";
import type { HistorySliceState } from "../features/history/index.ts";
import type {
  ConnectionStatus,
  HealthSliceState,
  HostConfig,
  RetryState,
} from "../features/hosts/index.ts";
import type { InboxEntry } from "../features/inbox/index.ts";
import type { MessagingSliceState } from "../features/messaging/index.ts";
import type { PersonasSliceState } from "../features/personas/index.ts";
import type { QuotaSliceState } from "../features/quota/index.ts";
import type { SessionsSliceState } from "../features/sessions/index.ts";
import type { SettingsSliceState } from "../features/settings/index.ts";
import type { SnippetsSliceState } from "../features/snippets/index.ts";
import type { SshSliceState } from "../features/ssh/index.ts";
import type { ClosingTerminal } from "../features/terminal/index.ts";
import type { SecretMeta, UsageEntry, VaultPolicy } from "../features/vault/index.ts";
import type { T } from "../i18n/index.ts";
import type { Client } from "./clients.ts";
import type { Finish } from "./finished.ts";
import type { GoogleConfig } from "./google-oauth.ts";
import type { WorktreeFilter } from "./project-tree.ts";
import type { Route } from "./router.ts";
import { sessionKey } from "./session-key.ts";
import { sessionLabel } from "./session-label.ts";
import type { SessionState } from "./session-state.ts";
import type { SetupProbe } from "./setup-steps.ts";
import type { UiMode } from "./simple-mode.ts";
import type { TerminalEnv } from "./terminal.ts";

/** What the sidebar knows about a session, straight from `session.summary`. */
export interface SidebarSession {
  id: string;
  name: string | null;
  cwd: string;
  status: SessionStatus;
  pendingPermissions: PendingPermission[];
  updatedAt: string;
  /** Phase 39: set for an OpenCode session only. */
  runtime?: SessionRuntime;
  /** Issue #463: its folder's trust was revoked after the run loaded the project's setup. */
  trustStale?: boolean;
  /** Issue #1478: the host marked it quiet (a running session that says nothing), since when. */
  quietSince?: string;
  /** Issue #1478: the last tool it called before it went quiet. */
  quietTool?: string | null;
}

export interface HostView extends HostConfig {
  status: ConnectionStatus;
  info: HelloResult | null;
  /** From `host.info`, fetched on each connect; `null` until then or on daemons without it. */
  hostInfo: HostInfoResult | null;
  /** When `hostInfo` arrived (epoch ms), so its uptime can be aged. */
  infoAt: number;
  /** The last failed try and the next one, while the host is offline. */
  retry: RetryState | null;
  /** Why the daemon refused this app's protocol, while `status` is `incompatible`. */
  incompatibility: string | null;
  /** Phase 9: an update of the daemon asked from the app, until it comes back on `target`. */
  daemonUpdate: { target: string; failed: string | null } | null;
  /** The daemon's update check asked for from the app: running, or why it did not run. */
  updateCheck: { busy: boolean; failed: string | null } | null;
  sessions: SidebarSession[];
}

export interface Selection {
  hostId: string;
  sessionId: string | null;
}

export interface AppState
  extends HistorySliceState,
    SnippetsSliceState,
    ActivitySliceState,
    SessionsSliceState,
    MessagingSliceState,
    BudgetsSliceState,
    ClientBudgetsSliceState,
    PersonasSliceState,
    SshSliceState,
    HealthSliceState,
    BackgroundSliceState,
    QuotaSliceState,
    AccountSliceState,
    SettingsSliceState {
  hosts: HostView[];
  /** Keyed by `sessionKey(hostId, sessionId)`. */
  sessions: Record<string, SessionState>;
  selected: Selection | null;
  error: string | null;
  /** The notifications the app sent, newest first, kept for the notification center. */
  inbox: InboxEntry[];
  /** Text handed to a session's message box that the box has not taken yet, by session key. */
  composerFill: Record<string, string>;
  /** The sessions that finished, newest first; Needs you lists those after the last look. */
  finished: Finish[];
  /** When the person last looked at Needs you (ISO), `null` before the first look. */
  finishedLook: string | null;
  /** A terminal tab whose close waits for the user to say detach or end (phase 14). */
  closingTerminal: ClosingTerminal | null;
  /** The run environment of each card (phase 24), by `host/card`. */
  runEnvs: Record<string, RunState>;
  /** Sessions that replied while no tab showed them (phase 14), by session key. */
  unread: Record<string, true>;
  /** Board cards seen so far, keyed by `sessionKey(hostId, cardId)`; kept by `card.updated`. */
  cards: Record<string, Card>;
  /** Sessions opened outside Flightdeck, by `sessionKey(hostId, claudeSessionId)`. */
  externals: Record<string, ExternalSession>;
  /** Open permission requests of external sessions, by `sessionKey(hostId, requestId)`. */
  externalRequests: Record<string, ExternalPermissionFrame>;
  /** Name, pinned and archived, by `sessionKey(hostId, claudeSessionId)`. */
  meta: Record<string, SessionMeta>;
  /** Phase 33: the mode the person chose for each host (a host without one follows its default). */
  uiChoices: Record<string, UiMode>;
  /** What hosts answered for the setup checklist (hooks, GitHub), by host id (issue #164). */
  setupProbes: Record<string, SetupProbe>;
  /** Phase 16: the vault's list, metadata only (a value is only read to be delivered). */
  secrets: SecretMeta[];
  /** Phase 16: the vault's usage log, newest first; never holds a value. */
  vaultUsage: UsageEntry[];
  /** Phase 17: the daemon's requests for a secret, waiting for the user; they join the queue. */
  vaultApprovals: PendingItem[];
  /** Phase 21: the standard session names of each host that announces `names`, by host id. */
  names: Record<string, SessionNameInfo[]>;
  /** Issue #1478: quiet sessions the person snoozed, by `host/session`, until this time (ms). */
  quietSnooze: Record<string, number>;
  /** Phase 22: the PR watch of each card that has been looked at or changed, by `sessionKey(hostId, cardId)`. */
  watches: Record<string, WatchInfo>;
  /** Workflow runs seen so far, by `sessionKey(hostId, runId)`; kept by `run.updated`. */
  runs: Record<string, WorkflowRun>;
  /** Managed and history lists of each host for the Sessões screen. */
  hub: Record<string, { managed: SessionSummary[]; history: HistorySessionSummary[] }>;
  /** This machine's terminals (phase 8), probed at init; `null` where none can be opened. */
  terminalEnv: TerminalEnv | null;
  /** Toasts still to show or still open (phase 10). */
  notices: Notice[];
  /** Projects of each host, loaded for the Ctrl+K palette (phase 8). */
  projects: Record<string, Project[]>;
  /** Phase 29: the clients, in the order their rules are tried; kept by `store.clients`. */
  clientList: Client[];
  /** Phase 36: counts the saves of `store.roi`, so the screens that read its settings render again. */
  roiRevision: number;
  /** The checkout picked in the sidebar tree: it narrows the board and the Sessions list (issue #116). */
  worktreeFilter: WorktreeFilter | null;
  /** Phase 29: projects pinned to a client by hand (null: pinned to Unassigned). */
  clientOverrides: Record<string, string | null>;
  /** Phase 29: "all", "unassigned" or a client id; what the work screens show. */
  clientSelection: string;
  /** The saved hosts are in `hosts` (init done with them); routes wait for it (phase 10). */
  hostsLoaded: boolean;
  /** Phase 9: the app's own update. */
  appUpdate: AppUpdateState;
}

/** What reading the app's release notes came to: the releases, no host that can read them, or a refusal. */
export type ReleaseNotesResult =
  | { kind: "ready"; releases: ReleaseNote[] }
  | { kind: "none" }
  | { kind: "error"; message: string };

export interface AppStoreOptions {
  /** The screen of a fresh window; a window saved before keeps its tabs. Sessions when absent. */
  startRoute?: Route;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Least time between two wake-ups (focus, network back) that retry the offline hosts. */
  wakeDebounceMs?: number;
  /** How long the global search waits for each host. */
  searchTimeoutMs?: number;
  /** Starts the poll of the GitHub sign-in (calls `tick` now and then, returns its stop); tests drive it by hand. */
  githubTicker?: (tick: () => void) => () => void;
  /** Milliseconds now: the age of quota readings. */
  now?: () => number;
  /** HH:MM of an instant (quota resets); the host machine's time zone when absent. */
  formatTime?: (iso: string) => string;
  /** IANA time zone of the dates shown (the machine's when absent); tests pin one. */
  timeZone?: string;
  /** Timers of the tray submenu's debounce (phase 8); the real ones when absent. */
  timers?: {
    setTimeout(fn: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
  };
  /** `YYYY-MM-DD` of an instant (cost periods); this machine's time zone when absent. */
  day?: (ms: number) => string;
  /** How long a host may take to come back on the new daemon version (2 min when absent). */
  daemonUpdateTimeoutMs?: number;
  /** How often the app looks for its own update while open (6 h when absent). */
  appUpdateIntervalMs?: number;
  /** How often the clients' month limits are looked at (phase 29); 10 minutes when absent. */
  clientBudgetIntervalMs?: number;
  /** Phase 16: decides a `vault.request` of the daemon; denies them all when absent. */
  vaultPolicy?: VaultPolicy;
  /** Phase 21: how often the app tells each daemon the others' sessions (5 s when absent). */
  peersSyncMs?: number;
  /** scrypt work factor (log2 N) of an exported vault; tests lower it to stay fast. */
  vaultWorkFactor?: number;
  /** Issue #1444: Google Drive for the scheduled backups; the build's own client id when absent. */
  google?: { config: GoogleConfig | null; fetch?: typeof fetch };
}

/** A toast: a host's error (by code, the daemon's message as detail) or a short success. */
export interface Notice {
  id: number;
  kind: "error" | "success";
  /** The daemon's error code; "" for an app-side error or a success. */
  code: string;
  text: string;
  /** Why, when the host sent a reason the app translates (see `refusalText`). */
  reason?: string;
  params?: Record<string, string | number>;
  /** The host the refusal came from, when it came from one. */
  hostId?: string;
  /** Runs the refused action again (after the person fixed what it needed). */
  retry?: () => void;
  /** The refusal of a command the person gave: its toast takes the focus when the step lost it (#1546). */
  answersCommand?: true;
  /** A success toast's button: where the news leads (Open the card). */
  link?: { label: string; run: () => void };
}

export interface PendingItem {
  hostId: string;
  hostName: string;
  sessionId: string;
  sessionName: string;
  /** Issue #1545: the project of the card that asks, so two cards of one title stay apart. */
  projectName?: string;
  requestId: string;
  toolName: string;
  createdAt: string;
  /** A request of a session opened outside Flightdeck (`sessionId` is its claudeSessionId). */
  external?: boolean;
  /** The tool input, long strings cut (phase 8: the tray shows a summary). */
  input?: Record<string, unknown>;
  /** The session's folder (phase 10: the queue's card makes paths relative to it). */
  cwd?: string | null;
  /** An open gate of a workflow run (`sessionId` is the card), answered with `gate.respond`. */
  gate?: GateRef;
  /** What the gate asks and shows, so it is approved in sight of it (issue #245). */
  gateText?: { message: string; output?: string };
  /** Phase 13: the risk the daemon judged for the request; an older daemon sends none. */
  risk?: RiskLevel;
  riskReason?: string;
  /** Issue #88: the request in plain words, for the surfaces outside the window; an older daemon sends none. */
  plain?: PlainInfo;
  /** Phase 17: the daemon asks for a secret to run an action or a free command. */
  vault?: true;
  /** Phase 19: the rule lets this request be approved for the rest of the session. */
  vaultOnce?: true;
  /** Phase 19: what a rule made from this request matches ("Criar regra a partir disto"). */
  vaultRule?: { secretId: string; match: Record<string, string> };
}

export interface GateRef {
  runId: string;
  stepId: string;
  attempt: number;
  cardId: string;
}

/** The parts of the state the requests waiting for the person are made of. */
export type NeedsYouState = Pick<
  AppState,
  | "cards"
  | "externalRequests"
  | "externals"
  | "hosts"
  | "meta"
  | "names"
  | "personas"
  | "runs"
  | "vaultApprovals"
> &
  Partial<Pick<AppState, "projects">>;

/**
 * Every open permission request of every host, oldest first. `t`: the dictionaries, so a team
 * session is named by its persona (#101); without, as before.
 */
export function needsYou(state: NeedsYouState, t?: T): PendingItem[] {
  const requests: PendingItem[] = state.hosts.flatMap((host) => {
    const names = state.names?.[host.id] ?? [];
    const projects = state.projects?.[host.id];
    const projectOf = (card: Card | undefined): { projectName?: string } => {
      const name = card && projects?.find((p) => p.id === card.projectId)?.name;
      return name ? { projectName: name } : {};
    };
    // Only a host with projects can have a card behind a session.
    const ofSession = (id: string) =>
      projects?.length
        ? projectOf(
            Object.entries(state.cards).find(
              ([key, card]) => key.startsWith(`${host.id}/`) && card.sessionId === id,
            )?.[1],
          )
        : {};
    const label = (id: string, metaName: string | null | undefined, createdName?: string | null) =>
      sessionLabel(
        {
          metaName,
          createdName,
          names: names.find((n) => n.sessionId === id),
          personas: state.personas?.[host.id],
        },
        t,
      );
    return [
      ...host.sessions.flatMap((session) =>
        session.pendingPermissions.map((p) => ({
          hostId: host.id,
          hostName: host.name,
          sessionId: session.id,
          sessionName:
            label(session.id, state.meta[sessionKey(host.id, session.id)]?.name, session.name) ??
            basename(session.cwd),
          ...ofSession(session.id),
          requestId: p.requestId,
          toolName: p.toolName,
          createdAt: p.createdAt,
          ...(p.input ? { input: p.input } : {}),
          ...(p.risk ? { risk: p.risk } : {}),
          ...(p.riskReason ? { riskReason: p.riskReason } : {}),
          ...(p.plain ? { plain: p.plain } : {}),
          cwd: session.cwd,
        })),
      ),
      // Sessions opened in the terminal: the hook holds the request while the app watches.
      ...Object.entries(state.externalRequests)
        .filter(([key]) => key.startsWith(`${host.id}/`))
        .map(([, request]) => {
          const id = request.claudeSessionId;
          const session = state.externals[sessionKey(host.id, id)];
          const name = state.meta[sessionKey(host.id, id)]?.name;
          return {
            hostId: host.id,
            hostName: host.name,
            sessionId: id,
            sessionName: label(id, name) ?? basename(session?.cwd ?? id),
            requestId: request.requestId,
            toolName: request.toolName,
            createdAt: request.createdAt,
            external: true,
            input: request.input,
            ...(request.risk ? { risk: request.risk } : {}),
            ...(request.riskReason ? { riskReason: request.riskReason } : {}),
            cwd: session?.cwd ?? null,
          };
        }),
      // Open gates of the host's workflow runs.
      ...Object.entries(state.runs)
        .filter(([key]) => key.startsWith(`${host.id}/`))
        .flatMap(([, run]) =>
          run.steps
            .filter((step) => step.type === "gate" && step.status === "waiting")
            .map((step) => ({
              hostId: host.id,
              hostName: host.name,
              sessionId: run.cardId,
              sessionName: state.cards[sessionKey(host.id, run.cardId)]?.title ?? run.workflowName,
              ...projectOf(state.cards[sessionKey(host.id, run.cardId)]),
              requestId: `gate:${run.id}/${step.stepId}/${step.attempt}`,
              toolName: `gate ${step.stepId}`,
              createdAt: step.startedAt,
              gate: {
                runId: run.id,
                stepId: step.stepId,
                attempt: step.attempt,
                cardId: run.cardId,
              },
              gateText: {
                message: step.message ?? "",
                ...(step.output ? { output: step.output } : {}),
              },
            })),
        ),
    ];
  });
  const known = state.vaultApprovals.filter((item) =>
    state.hosts.some((h) => h.id === item.hostId),
  );
  return [...requests, ...known].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** What goes with an answer to a request, besides allow or deny. */
export interface Answer {
  /** "Allow in this session" and "always in this project" (phase 7). */
  updatedPermissions?: PermissionUpdate[];
  /** Why it was denied (phase 10: the card's reason). */
  message?: string;
  /** The tool's input as the person changed it (the answers of AskUserQuestion). */
  updatedInput?: Record<string, unknown>;
  /**
   * The Approve was held its full time (#245): a high-risk request is approved only with it, so a
   * screen that forgets the risk cannot approve one with a click.
   */
  held?: boolean;
}

/** Filters of the per-host history list. */
export type HistoryFilter = Omit<CommandPayload<"history.list">, "cursor" | "limit">;

/** Messages per `history.get` page in the transcript reader. */
export const HISTORY_PAGE = 50;
