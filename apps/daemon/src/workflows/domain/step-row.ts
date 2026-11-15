import type { StepRun, StepStatus, StepType } from "@flightdeck/protocol";
import * as col from "./row-json.ts";

export interface StepRow {
  run_id: string;
  step_id: string;
  attempt: number;
  type: StepType;
  status: StepStatus;
  session_id: string | null;
  output: string | null;
  exit_code: number | null;
  note: string | null;
  message: string | null;
  usage: string | null;
  started_at: string;
  ended_at: string | null;
}

export const toStep = (row: StepRow): StepRun => ({
  stepId: row.step_id,
  attempt: row.attempt,
  type: row.type,
  status: row.status,
  sessionId: row.session_id,
  output: row.output,
  exitCode: row.exit_code,
  note: row.note,
  message: row.message,
  usage: col.stepUsageOf(row.usage),
  startedAt: row.started_at,
  endedAt: row.ended_at,
});
