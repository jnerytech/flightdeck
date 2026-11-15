import { z } from "zod";
import { parseJsonOr } from "../../kernel/index.ts";
import type { Drift } from "./drift.ts";

/** One round of fixing a PR, as it is kept and shown (phase 22). */
export interface FixRound {
  id: string;
  cardId: string;
  n: number;
  /** `held`: the round drifted from its PR (#77); its commits wait for you. */
  status: "running" | "pushed" | "failed" | "stopped" | "held";
  /** What started it: the failed checks, the conflict, the comments. */
  trigger: { failed: string[]; conflicts: boolean; comments: string[] };
  summary: string | null;
  sessionId: string | null;
  costUsd: number;
  turns: number;
  startedAt: string;
  endedAt: string | null;
  /** A held round's files outside the PR and its churn (#77). */
  drift: Drift | null;
}

export interface RoundRow {
  id: string;
  card_id: string;
  n: number;
  status: FixRound["status"];
  trigger: string;
  summary: string | null;
  session_id: string | null;
  cost_usd: number;
  turns: number;
  started_at: string;
  ended_at: string | null;
  base_sha: string | null;
  held_sha: string | null;
  drift: string | null;
}

const TRIGGER = z.object({
  failed: z.array(z.string()),
  conflicts: z.boolean(),
  comments: z.array(z.string()),
});
const DRIFT = z.object({ outside: z.array(z.string()), churn: z.number(), limit: z.number() });

export const toRound = (row: RoundRow): FixRound => ({
  id: row.id,
  cardId: row.card_id,
  n: row.n,
  status: row.status,
  trigger: parseJsonOr(TRIGGER, row.trigger, { failed: [], conflicts: false, comments: [] }),
  summary: row.summary,
  sessionId: row.session_id,
  costUsd: row.cost_usd,
  turns: row.turns,
  startedAt: row.started_at,
  endedAt: row.ended_at,
  drift: row.drift ? parseJsonOr(DRIFT.nullable(), row.drift, null) : null,
});

/** A commit id as git prints it (SHA-1 or SHA-256): the only form a stored one goes back into git as. */
export const COMMIT_ID = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
