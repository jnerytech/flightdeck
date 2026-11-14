import type { RunBudget } from "@flightdeck/protocol";

/** What a run spent, plus the last cumulative cost seen from each session. */
export interface RunSpending {
  turns: number;
  minutes: number;
  costUsd: number;
  /** Session id → last `costUsd` (cumulative, like the SDK's `total_cost_usd`). */
  sessions: Record<string, number>;
}

export const noSpending = (): RunSpending => ({ turns: 0, minutes: 0, costUsd: 0, sessions: {} });

/**
 * One more turn. Its `costUsd` is the session's running total, so only what it adds to the last
 * total known for that session counts; a resumed session that starts from its previous total
 * adds just the difference, and a smaller total never subtracts.
 */
export function addTurn(
  spending: RunSpending,
  turn: { sessionId: string; costUsd?: number; minutes: number },
): RunSpending {
  const last = spending.sessions[turn.sessionId] ?? 0;
  const total = Math.max(last, turn.costUsd ?? last);
  return {
    turns: spending.turns + 1,
    minutes: spending.minutes + turn.minutes,
    costUsd: spending.costUsd + (total - last),
    sessions: { ...spending.sessions, [turn.sessionId]: total },
  };
}

const minutes = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));

/** Why the run must stop before another turn, or `null` while every limit still has room. */
export function overBudget(budget: RunBudget, spending: RunSpending): string | null {
  const { maxTurns, maxMinutes, maxCostUsd } = budget;
  if (maxTurns !== undefined && spending.turns >= maxTurns) {
    return `orçamento estourado: ${spending.turns} de ${maxTurns} turnos`;
  }
  if (maxMinutes !== undefined && spending.minutes >= maxMinutes) {
    return `orçamento estourado: ${minutes(spending.minutes)} de ${maxMinutes} minutos`;
  }
  if (maxCostUsd !== undefined && spending.costUsd >= maxCostUsd) {
    const spent = spending.costUsd.toFixed(2);
    return `orçamento estourado: US$ ${spent} de US$ ${maxCostUsd.toFixed(2)}`;
  }
  return null;
}
