import type { StepRun, WorkflowRun } from "@flightdeck/protocol";
import { useState } from "react";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { Meter } from "@/components/status/meter";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { usd } from "../lib/costs.ts";
import { budgetLines, RUN_LABELS, STEP_LABELS, stepDuration, stepUsage } from "../lib/runs.ts";

const stepKey = (step: StepRun) => `${step.stepId}#${step.attempt}`;

/** Turns, minutes and estimated cost against the run's budget. */
function BudgetMeter({ run }: { run: WorkflowRun }) {
  return (
    <section aria-label="Orçamento" className="flex flex-col gap-1 text-sm">
      {budgetLines(run).map((line) => (
        <div key={line.label} className="flex items-center gap-3">
          <span className="w-56 text-muted-foreground text-xs tabular-nums">{line.text}</span>
          {line.max !== undefined && <Meter label={line.label} value={line.value} max={line.max} />}
        </div>
      ))}
    </section>
  );
}

/** An open gate, answered here with an optional note. */
function GateCard(props: {
  step: StepRun;
  onRespond(step: StepRun, decision: "approve" | "reject", note: string): void;
}) {
  const { step } = props;
  const [note, setNote] = useState("");
  return (
    <section
      aria-label={`Gate ${step.stepId}`}
      className="mt-2 flex flex-col gap-2 rounded-lg border border-status-needs-you/50 p-3 text-sm"
    >
      <p>{step.message}</p>
      {step.output && (
        <pre className="overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs">
          {step.output}
        </pre>
      )}
      <Textarea
        aria-label="Nota do gate"
        placeholder="Nota (opcional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="flex gap-2">
        <Button size="sm" onClick={() => props.onRespond(step, "approve", note)}>
          Aprovar
        </Button>
        <Button variant="outline" size="sm" onClick={() => props.onRespond(step, "reject", note)}>
          Recusar
        </Button>
      </div>
    </section>
  );
}

/**
 * A card's workflow run: status, budget and one line per step attempt. Agent and check steps
 * open (their conversation or their output) through `onOpenStep`.
 */
export function RunTimeline(props: {
  run: WorkflowRun;
  /** HH:MM of an instant (the quota's reset). */
  formatTime(iso: string): string;
  onOpenStep(step: StepRun): void;
  onRespond(step: StepRun, decision: "approve" | "reject", note: string): void;
  /** Estimated cost of the run's sessions (phase 8); `null` when unknown. */
  costUsd?: number | null;
}) {
  const { run } = props;
  return (
    <section aria-label="Execução do workflow" className="flex flex-col gap-3">
      <h3 className="font-semibold text-sm">{`Workflow ${run.workflowName} · ${RUN_LABELS[run.status]}`}</h3>
      {typeof props.costUsd === "number" && (
        <p className="text-muted-foreground text-xs">
          custo estimado das sessões:{" "}
          <output aria-label="Custo da execução">{usd(props.costUsd)}</output>
        </p>
      )}
      {run.quotaUntil ? (
        <InlineNotice>{`aguardando cota até ${props.formatTime(run.quotaUntil)}`}</InlineNotice>
      ) : (
        run.statusReason && <InlineNotice>{run.statusReason}</InlineNotice>
      )}
      <BudgetMeter run={run} />
      <ol aria-label="Etapas" className="flex flex-col gap-1 text-sm">
        {run.steps.map((step) => {
          const line = [
            step.stepId,
            `tentativa ${step.attempt}`,
            STEP_LABELS[step.status],
            stepDuration(step),
            ...(step.usage ? [stepUsage(step.usage)] : []),
          ].join(" · ");
          const opens = step.type === "check" || (step.type === "agent" && step.sessionId);
          const attempt = step.attempt > 1 ? ` (tentativa ${step.attempt})` : "";
          return (
            <li key={stepKey(step)}>
              {opens ? (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Abrir etapa ${step.stepId}${attempt}`}
                  onClick={() => props.onOpenStep(step)}
                >
                  {line}
                </Button>
              ) : (
                <span className="px-3 text-muted-foreground text-xs">{line}</span>
              )}
              {step.type === "gate" && step.status === "waiting" && (
                <GateCard step={step} onRespond={props.onRespond} />
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
