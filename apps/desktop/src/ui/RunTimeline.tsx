import type { StepRun, WorkflowRun } from "@flightdeck/protocol";
import { useState } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { Meter } from "@/components/status/meter";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useBusy } from "@/hooks/use-busy";
import { useT } from "@/i18n/context";
import type { Key } from "../i18n/index.ts";
import { usd } from "../lib/costs.ts";
import { budgetLines, stepDuration, stepUsage } from "../lib/runs.ts";

const stepKey = (step: StepRun) => `${step.stepId}#${step.attempt}`;

/** Turns, minutes and estimated cost against the run's budget. */
function BudgetMeter({ run }: { run: WorkflowRun }) {
  const t = useT();
  return (
    <section aria-label={t("runUi.budget")} className="flex flex-col gap-1 text-sm">
      {budgetLines(run, t).map((line) => (
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
  onRespond(step: StepRun, decision: "approve" | "reject", note: string): unknown;
}) {
  const t = useT();
  const { step } = props;
  const [note, setNote] = useState("");
  // One answer at a time: both buttons wait for it.
  const { busy, run } = useBusy();
  return (
    <section
      aria-label={t("runUi.gate", { step: step.stepId })}
      className="mt-2 flex flex-col gap-2 rounded-lg border border-status-needs-you/50 p-3 text-sm"
    >
      <p>{step.message}</p>
      {step.output && (
        <pre className="overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs">
          {step.output}
        </pre>
      )}
      <Textarea
        aria-label={t("runUi.gateNote")}
        placeholder={t("runUi.notePlaceholder")}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="flex gap-2">
        <ActionButton
          size="sm"
          pending={busy}
          onClick={() => run(() => props.onRespond(step, "approve", note))}
        >
          {t("runUi.approve")}
        </ActionButton>
        <ActionButton
          variant="outline"
          size="sm"
          pending={busy}
          onClick={() => run(() => props.onRespond(step, "reject", note))}
        >
          {t("runUi.reject")}
        </ActionButton>
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
  /** A promise keeps the gate's buttons busy until the answer is in. */
  onRespond(step: StepRun, decision: "approve" | "reject", note: string): unknown;
  /** Estimated cost of the run's sessions (phase 8); `null` when unknown. */
  costUsd?: number | null;
}) {
  const t = useT();
  const { run } = props;
  return (
    <section aria-label={t("runUi.run")} className="flex flex-col gap-3">
      <h3 className="font-semibold text-sm">
        {t("runUi.title", {
          name: run.workflowName,
          status: t(`runUi.status.${run.status}` as Key),
        })}
      </h3>
      {typeof props.costUsd === "number" && (
        <p className="text-muted-foreground text-xs">
          {t("runUi.costLine")} <output aria-label={t("runUi.cost")}>{usd(props.costUsd)}</output>
        </p>
      )}
      {run.quotaUntil ? (
        <InlineNotice>
          {t("runUi.waitingQuota", { time: props.formatTime(run.quotaUntil) })}
        </InlineNotice>
      ) : (
        run.statusReason && <InlineNotice>{run.statusReason}</InlineNotice>
      )}
      <BudgetMeter run={run} />
      <ol aria-label={t("runUi.steps")} className="flex flex-col gap-1 text-sm">
        {run.steps.map((step) => {
          const line = [
            step.stepId,
            t("runUi.attempt", { n: step.attempt }),
            t(`runUi.step.${step.status}` as Key),
            stepDuration(step),
            ...(step.usage ? [stepUsage(step.usage, t)] : []),
          ].join(" · ");
          const opens = step.type === "check" || (step.type === "agent" && step.sessionId);
          const attempt = step.attempt > 1 ? t("runUi.attemptNote", { n: step.attempt }) : "";
          return (
            <li key={stepKey(step)}>
              {opens ? (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t("runUi.openStep", { step: step.stepId, attempt })}
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
