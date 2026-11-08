export const INCIDENT_MAX = 3000;
export const FIELD_MAX = 600;
export const STEP_OUTPUT_MAX = 300;

/** What the incident text reads of a failed card; the card, its run and its session's summary. */
export interface IncidentInput {
  card: { title: string; notice: string | null; prUrl: string | null };
  run: {
    workflowName: string;
    status: string;
    statusReason: string | null;
    steps: Array<{ stepId: string; type: string; status: string; output: string | null }>;
  } | null;
  recap: {
    asked: string | null;
    done: string | null;
    files: string[];
    filesMore: number;
    question: string | null;
  } | null;
}

export function incidentText(_input: IncidentInput): string {
  return "";
}
