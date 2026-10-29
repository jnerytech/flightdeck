import type { Database } from "bun:sqlite";

export interface RetentionPolicy {
  /** Events and permission requests of managed sessions ended more than this many days ago. */
  eventsDays: number;
  /** External sessions ended more than this many days ago. 0 means "as soon as it ends". */
  externalSessionsDays: number;
}

export type PruneCounts = {
  events: number;
  permission_requests: number;
  external_sessions: number;
};

const DAY_MS = 86_400_000;

/**
 * Managed sessions whose data may go: ended (or failed) before the cutoff, not pinned, and not
 * the session of a card (directly or through a workflow step) that is still outside Concluído.
 * The session row itself, cards, workflow runs and session_meta always stay.
 */
const PRUNABLE_SESSIONS = `
  SELECT s.id FROM sessions s
  WHERE s.status IN ('ended', 'error') AND s.updated_at <= $cutoff
    AND NOT EXISTS (SELECT 1 FROM session_meta m
                    WHERE m.claude_session_id = s.claude_session_id AND m.pinned = 1)
    AND NOT EXISTS (SELECT 1 FROM card_runs r JOIN cards c ON c.id = r.card_id
                    WHERE r.session_id = s.id AND c.board_column <> 'done')
    AND NOT EXISTS (SELECT 1 FROM step_runs st JOIN workflow_runs w ON w.id = st.run_id
                    JOIN cards c ON c.id = w.card_id
                    WHERE st.session_id = s.id AND c.board_column <> 'done')`;

/** External sessions that may go: ended before the cutoff and not pinned. */
const PRUNABLE_EXTERNAL = `
  FROM external_sessions e
  WHERE e.status = 'ended' AND e.ended_at <= $cutoff
    AND NOT EXISTS (SELECT 1 FROM session_meta m
                    WHERE m.claude_session_id = e.claude_session_id AND m.pinned = 1)`;

const cutoffOf = (now: number, days: number) => new Date(now - days * DAY_MS).toISOString();

/** Applies the retention policy (or only counts, with `dryRun`); returns the rows per table. */
export function prune(
  db: Database,
  policy: RetentionPolicy,
  opts: { now: number; dryRun?: boolean },
): PruneCounts {
  const sessions = { cutoff: cutoffOf(opts.now, policy.eventsDays) };
  const external = { cutoff: cutoffOf(opts.now, policy.externalSessionsDays) };
  const count = (sql: string, params: { cutoff: string }) =>
    (db.query(sql).get(params) as { n: number }).n;
  const counts: PruneCounts = {
    events: count(
      `SELECT COUNT(*) AS n FROM events WHERE session_id IN (${PRUNABLE_SESSIONS})`,
      sessions,
    ),
    permission_requests: count(
      `SELECT COUNT(*) AS n FROM permission_requests WHERE session_id IN (${PRUNABLE_SESSIONS})`,
      sessions,
    ),
    external_sessions: count(`SELECT COUNT(*) AS n ${PRUNABLE_EXTERNAL}`, external),
  };
  if (opts.dryRun) return counts;
  db.transaction(() => {
    db.query(`DELETE FROM events WHERE session_id IN (${PRUNABLE_SESSIONS})`).run(sessions);
    db.query(`DELETE FROM permission_requests WHERE session_id IN (${PRUNABLE_SESSIONS})`).run(
      sessions,
    );
    db.query(
      `DELETE FROM external_sessions WHERE claude_session_id IN (SELECT e.claude_session_id ${PRUNABLE_EXTERNAL})`,
    ).run(external);
  })();
  return counts;
}
