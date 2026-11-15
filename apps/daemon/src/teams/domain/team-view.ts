/**
 * A team as the app sees it (#1589): the stored row, its members and the messages they sent, turned
 * into `TeamInfo` and `TeamStatus`. Pure: the live session of a worker and the message list come in.
 */
import type { MessageInfo, TeamInfo, TeamMember, TeamStatus } from "@flightdeck/protocol";
import type { StoredMember, TeamRow } from "./stored.ts";
import { numberOf } from "./worker.ts";

/** The session a member runs now and its state: a worker's comes from its card, so the host looks it up. */
export interface LiveMember {
  sessionId: string | null;
  state: TeamMember["sessionState"];
}

/** A member as the app sees it. */
export function toMember(stored: StoredMember, host: string, live: LiveMember): TeamMember {
  return {
    name: stored.name,
    role: stored.role,
    persona: stored.persona,
    model: stored.model ?? null,
    permission: stored.permission ?? null,
    cardId: stored.cardId,
    sessionId: live.sessionId,
    address: live.sessionId ? `${host}/${live.sessionId}` : null,
    sessionState: live.state,
    number: numberOf(stored),
  };
}

export function toInfo(row: TeamRow, members: TeamMember[], checks: string[]): TeamInfo {
  return {
    id: row.id,
    name: row.name,
    projectId: row.project_id,
    goal: row.goal,
    coordinator: row.coordinator,
    members,
    checks,
    state: row.state,
    pausedBy: row.paused_by,
    instructionsVersion: row.instructions_version,
    createdAt: row.created_at,
  };
}

/** The team's state: its outcome, and for each member the last report and how many messages it sent and got. */
export function toStatus(
  team: TeamInfo,
  row: Pick<TeamRow, "report_text" | "report_at" | "report_done">,
  listed: MessageInfo[],
): TeamStatus {
  const messages = listed.filter((m) => m.kind === "session");
  const last = (member: TeamMember): MessageInfo | undefined =>
    messages.find((m) => m.fromSession === member.sessionId);
  return {
    team,
    messages: messages.length,
    outcome:
      row.report_text && row.report_at
        ? { text: row.report_text, at: row.report_at, done: row.report_done === 1 }
        : null,
    members: team.members.map((member) => {
      const report = last(member);
      return {
        ...member,
        lastReport: report ? { text: report.text, at: report.createdAt } : null,
        sent: messages.filter((m) => m.fromSession === member.sessionId).length,
        received: messages.filter((m) => m.toSession === member.sessionId).length,
      };
    }),
  };
}
