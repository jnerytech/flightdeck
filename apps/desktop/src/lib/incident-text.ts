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

/** The failed steps listed: a run that failed many times over says enough with the first few. */
const STEPS_MAX = 5;

/** What a person must not be shown, or a prompt carry: controls, invisible and unassigned code points. */
const NOT_SHOWN = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Cs}\p{Zl}\p{Zp}\u00A0]/u;

/** A line that reads as a fence or a heading: it could close the block the incident sits in. */
const FENCE_LINE = /^\s*(?:-{3,}|`{3,}|~{3,}|#)/;

/**
 * One line of text from a field that may have many: invisible characters gone, the lines that look
 * like a fence or a heading dropped, a run of dashes cut short, cut to `max`. The text comes from
 * an agent's session, so it is data in the prompt, never a way out of the block that holds it.
 */
function clean(value: string | null | undefined, max: number): string {
  if (!value) return "";
  const kept = value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) =>
      [...line]
        .filter((char) => !NOT_SHOWN.test(char))
        .join("")
        .trim(),
    )
    .filter((line) => line !== "" && !FENCE_LINE.test(line))
    .join(" ")
    .replace(/-{3,}/g, "--")
    .replace(/\s+/g, " ")
    .trim();
  return [...kept].slice(0, max).join("");
}

/** `label: text`, or nothing when the text is empty once cleaned. */
const fact = (label: string, text: string): string[] => (text === "" ? [] : [`${label}: ${text}`]);

/** The files the session touched, with how many more there were; nothing when none is named. */
function filesText(recap: IncidentInput["recap"]): string {
  const files = (recap?.files ?? []).map((file) => clean(file, 200)).filter(Boolean);
  if (files.length === 0) return "";
  const more = recap?.filesMore ?? 0;
  return more > 0 ? `${files.join(", ")} (and ${more} more)` : files.join(", ");
}

/**
 * Issue #79: the facts of a failed card as the `incident` input of the post-mortem workflow. Plain
 * English lines, bounded and cleaned; the person reads and edits them before anything starts.
 */
export function incidentText(input: IncidentInput): string {
  const { card, run, recap } = input;
  const failedSteps = (run?.steps ?? []).filter((step) => step.status === "failed");
  const lines = [
    ...fact("Card", clean(card.title, FIELD_MAX)),
    ...fact("Pull request", clean(card.prUrl, FIELD_MAX)),
    ...fact("Problem on the card", clean(card.notice, FIELD_MAX)),
    ...(run
      ? fact(
          "Workflow run",
          `${clean(run.workflowName, 100)}, ${clean(run.status, 40)}${
            clean(run.statusReason, FIELD_MAX) ? ` (${clean(run.statusReason, FIELD_MAX)})` : ""
          }`,
        )
      : []),
    ...failedSteps.slice(0, STEPS_MAX).flatMap((step) => {
      const output = clean(step.output, STEP_OUTPUT_MAX);
      const said = output ? `: ${output}` : "";
      return fact("Failed step", `${clean(step.stepId, 100)} (${clean(step.type, 40)})${said}`);
    }),
    ...fact("Asked", clean(recap?.asked, FIELD_MAX)),
    ...fact("Done", clean(recap?.done, FIELD_MAX)),
    ...fact("Files", filesText(recap)),
    ...fact("Open question", clean(recap?.question, FIELD_MAX)),
  ];
  return [...lines.join("\n")].slice(0, INCIDENT_MAX).join("");
}
