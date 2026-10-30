/**
 * Phase 21: the instructions a team runs on. They are product text, versioned.
 */

/** Bump when the text changes meaning. */
export const INSTRUCTIONS_VERSION = "0";

export interface TeamBrief {
  name: string;
  goal: string;
  /** What the coordinator runs to check a worker's work; the project's own checks when empty. */
  checks: string[];
  workers: Array<{ name: string; persona: string | null; cardId: string | null }>;
}

export function coordinatorInstructions(_brief: TeamBrief): string {
  return "";
}

export function workerInstructions(_brief: TeamBrief, _coordinator: string | null): string {
  return "";
}
