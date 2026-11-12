import type { SessionEventOf, TeamInfo } from "@flightdeck/protocol";
import { parseRequestLink, requestLink } from "@/features/permissions/index.ts";
import { basename } from "@/shared/lib/index.ts";
import type { T } from "../../i18n/index.ts";
import type { SidebarSession } from "../../lib/app-store.ts";
import type { InboxSlice } from "../inbox/index.ts";
import { type AboutNotification, summaryNotifications } from "../inbox/notify.ts";
import { decide, type NotifyPreferences, type NotifySource } from "../notifications/index.ts";
import { sessionKey } from "./session-key.ts";

/** How long workers of one team finishing are gathered into one message. */
const FOLD_MS = 10_000;

type Summary = SessionEventOf<"session.summary">;

/** What the summaries read and ask through the app's store. */
export interface SummariesCore {
  /** The hosts and the sessions each lists. */
  hosts(): Array<{ id: string; name: string; sessions: SidebarSession[] }>;
  /** Marks sessions as unread (a reply arrived while they were not on screen). */
  markUnread(keys: string[]): void;
  /** Replaces a host's session list, as one change. */
  setSessions(hostId: string, sessions: SidebarSession[]): void;
  /** The sessions an area shows right now, by session key. */
  shown(): Set<string>;
  /** `hostId/projectId` of the project whose folder holds `cwd`, if any. */
  projectOf(hostId: string, cwd: string | null | undefined): string | undefined;
  isSimple(hostId: string): boolean;
  isFocused(): boolean;
  prefs(): NotifyPreferences["value"];
  now(): number;
  t(): T;
  notify: InboxSlice["notify"];
  /** The managed session's change, for the webhooks. */
  feed(
    host: { id: string; name: string },
    prev: SidebarSession | undefined,
    next: SidebarSession,
  ): void;
  /** A turn, a failure or an end is a finish for Needs you. */
  finished(hostId: string, prev: SidebarSession | undefined, next: SidebarSession): void;
  /** Runs `fn` after `ms` (the store's timers). */
  later(fn: () => void, ms: number): void;
}

/**
 * What a host's session summaries tell the person (#1596: a slice of the store): the sidebar's
 * sessions, the unread marks, the notifications they raise and, for a team's workers, the one
 * message that gathers the turns they finished together.
 */
export class SummariesSlice {
  /** The sessions that belong to a team, by session key (issue #149: workers are folded). */
  private readonly teamOf = new Map<
    string,
    { hostId: string; team: string; name: string; worker: boolean }
  >();
  /** Workers' finished turns waiting to be folded into one message per team. */
  private readonly folding = new Map<
    string,
    { name: string; hostId: string; items: Array<{ n: AboutNotification; source: NotifySource }> }
  >();

  constructor(private readonly core: SummariesCore) {}

  /** Remembers which sessions are workers of which team, for folding their notifications. */
  rememberTeam(hostId: string, team: TeamInfo): void {
    for (const [key, known] of this.teamOf) {
      if (known.hostId === hostId && known.team === team.id) this.teamOf.delete(key);
    }
    if (team.state === "closed") return;
    for (const member of team.members) {
      if (!member.sessionId) continue;
      this.teamOf.set(sessionKey(hostId, member.sessionId), {
        hostId,
        team: team.id,
        name: team.name,
        worker: member.role === "worker",
      });
    }
  }

  /**
   * A host's summaries, in order, as one change of its sessions (#1191): the snapshot of a host
   * with hundreds of sessions renders the app once, not once per session. What each one tells the
   * person (unread, notifications, finished) still follows each in turn.
   */
  apply(hostId: string, summaries: Summary[]): void {
    const host = this.core.hosts().find((h) => h.id === hostId);
    if (!host || summaries.length === 0) return;
    const sessions = [...host.sessions];
    const at = new Map(sessions.map((session, i) => [session.id, i]));
    const changes: Array<{ prev: SidebarSession | undefined; next: SidebarSession }> = [];
    for (const summary of summaries) {
      const next: SidebarSession = {
        id: summary.sessionId,
        name: summary.name,
        cwd: summary.cwd,
        status: summary.status,
        pendingPermissions: summary.pendingPermissions,
        updatedAt: summary.updatedAt,
        ...(summary.runtime ? { runtime: summary.runtime } : {}),
        ...(summary.trustStale ? { trustStale: true } : {}),
        ...(summary.quietSince
          ? { quietSince: summary.quietSince, quietTool: summary.quietTool ?? null }
          : {}),
      };
      const i = at.get(next.id);
      const prev = i === undefined ? undefined : sessions[i];
      if (i === undefined) {
        at.set(next.id, sessions.length);
        sessions.push(next);
      } else {
        sessions[i] = next;
      }
      changes.push({ prev, next });
    }
    this.core.setSessions(hostId, sessions);
    const shown = this.core.shown();
    const unread = changes.flatMap(({ prev, next }) => {
      const replied =
        (prev?.status === "running" || prev?.status === "starting") && next.status === "idle";
      const key = sessionKey(hostId, next.id);
      return replied && !shown.has(key) ? [key] : [];
    });
    if (unread.length > 0) this.core.markUnread(unread);
    for (const { prev, next } of changes) {
      this.core.feed({ id: hostId, name: host.name }, prev, next);
      this.tell(hostId, host.name, prev, next);
      this.core.finished(hostId, prev, next);
    }
  }

  /** What a changed summary tells the person: the notifications it raises, or folds into its team's. */
  private tell(
    hostId: string,
    hostName: string,
    prev: SidebarSession | undefined,
    next: SidebarSession,
  ): void {
    const key = sessionKey(hostId, next.id);
    const label = `${hostName} · ${next.name ?? basename(next.cwd)}`;
    const linkFor = (requestId: string) => requestLink(hostId, requestId);
    const focused = this.core.isFocused();
    const t = this.core.t();
    const names = { subject: next.name ?? basename(next.cwd), host: hostName, group: key };
    const project = this.core.projectOf(hostId, next.cwd);
    const team = this.teamOf.get(key);
    const simple = this.core.isSimple(hostId);
    for (const n of summaryNotifications(prev, next, label, focused, {
      linkFor,
      t,
      names,
      simple,
    })) {
      const source: NotifySource = {
        event: n.event ?? "other",
        hostId,
        session: key,
        ...(project ? { project } : {}),
        ...(team?.worker ? { worker: true } : {}),
      };
      // A worker's finished turn waits a moment to be told with its team's others.
      if (team && decide(this.core.prefs(), source, this.core.now()).fold) {
        this.fold(`${hostId}/${team.team}`, team.name, hostId, { n, source });
        continue;
      }
      // A request's entry keeps its session too: once answered, the bell opens it at that request.
      const requestId = n.link ? parseRequestLink(n.link)?.requestId : undefined;
      this.core.notify(
        n,
        requestId ? { name: "session", host: hostId, id: next.id, focus: requestId } : undefined,
        undefined,
        source,
      );
    }
  }

  private fold(
    teamKey: string,
    name: string,
    hostId: string,
    item: { n: AboutNotification; source: NotifySource },
  ): void {
    const pending = this.folding.get(teamKey);
    if (pending) {
      pending.items.push(item);
      return;
    }
    this.folding.set(teamKey, { name, hostId, items: [item] });
    this.core.later(() => this.flush(teamKey), FOLD_MS);
  }

  private flush(teamKey: string): void {
    const pending = this.folding.get(teamKey);
    this.folding.delete(teamKey);
    const [first] = pending?.items ?? [];
    if (!pending || !first) return;
    if (pending.items.length === 1) {
      // Alone, a worker is told as itself (not folded: it has nothing to fold with).
      this.core.notify(first.n, undefined, undefined, { ...first.source, worker: false });
      return;
    }
    const t = this.core.t();
    this.core.notify(
      {
        event: "turn-finished",
        title: t("notify.teamDone", { team: pending.name, n: pending.items.length }),
        body: t("notify.teamDoneBody"),
        about: {
          subject: pending.name,
          host: first.n.about?.host ?? pending.hostId,
          group: teamKey,
        },
      },
      { name: "teams", host: pending.hostId, team: teamKey.split("/")[1] ?? "" },
      undefined,
      {
        event: "turn-finished",
        hostId: pending.hostId,
        ...(first.source.project ? { project: first.source.project } : {}),
      },
    );
  }
}
