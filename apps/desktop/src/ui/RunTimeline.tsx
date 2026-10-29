import type { StepRun, WorkflowRun } from "@flightdeck/protocol";
import { budgetLines, RUN_LABELS, STEP_LABELS, stepDuration } from "../lib/runs.ts";

const stepKey = (step: StepRun) => `${step.stepId}#${step.attempt}`;

/** Turns, minutes and estimated cost against the run's budget. */
function BudgetMeter({ run }: { run: WorkflowRun }) {
  return (
    <section aria-label="Orçamento" className="budget">
      {budgetLines(run).map((line) => (
        <div key={line.label} className="row">
          <span>{line.text}</span>
          {line.max !== undefined && (
            <meter aria-label={line.label} value={line.value} max={line.max} />
          )}
        </div>
      ))}
    </section>
  );
}

/**
 * A card's workflow run: status, budget and one line per step attempt. Agent and check steps
 * open (their conversation or their output) through `onOpenStep`.
 */
export function RunTimeline(props: { run: WorkflowRun; onOpenStep(step: StepRun): void }) {
  const { run } = props;
  return (
    <section aria-label="Execução do workflow" className="run">
      <h3>{`Workflow ${run.workflowName} · ${RUN_LABELS[run.status]}`}</h3>
      {run.statusReason && <p className="notice">{run.statusReason}</p>}
      <BudgetMeter run={run} />
      <ol aria-label="Etapas">
        {run.steps.map((step) => {
          const line = [
            step.stepId,
            `tentativa ${step.attempt}`,
            STEP_LABELS[step.status],
            stepDuration(step),
          ].join(" · ");
          const opens = step.type === "check" || (step.type === "agent" && step.sessionId);
          const attempt = step.attempt > 1 ? ` (tentativa ${step.attempt})` : "";
          return (
            <li key={stepKey(step)}>
              {opens ? (
                <button
                  type="button"
                  aria-label={`Abrir etapa ${step.stepId}${attempt}`}
                  onClick={() => props.onOpenStep(step)}
                >
                  {line}
                </button>
              ) : (
                <span>{line}</span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
