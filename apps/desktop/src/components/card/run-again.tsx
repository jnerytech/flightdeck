import type { WorkflowInfo, WorkflowRun } from "@flightdeck/protocol";
import { useEffect, useId, useRef, useState } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { Stack } from "@/components/layout/stack";
import { Button } from "@/components/ui/button";
import { refusalText } from "@/i18n/errors";
import type { Key } from "@/i18n/index";
import type { AppStore } from "@/lib/app-store";
import { runAgain } from "@/lib/runs";

export interface RunAgainProps {
  store: AppStore;
  hostId: string;
  cardId: string;
  run: WorkflowRun;
  /** The host's current word on the run's workflow file; `undefined` when it is not there. */
  workflow: WorkflowInfo | undefined;
  /** The host has answered `workflow.list`. */
  known: boolean;
  /** Opens the project's Workflows page, where a file is reviewed and trusted. */
  onOpenWorkflows(): void;
}

/**
 * Issue #1219: a failed run starts again from the card, with the same workflow, inputs, card and
 * branch (`card.start`), or says why it cannot: when the workflow file is the problem, the way is
 * the Workflows page. A refusal of the host shows here, not in the banner.
 */
export function RunAgain(props: Readonly<RunAgainProps>) {
  const { store, hostId, cardId, run } = props;
  const { t } = store.i18n;
  const state = runAgain(run, props.workflow, props.known);
  const [refused, setRefused] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const refusedBox = useRef<HTMLDivElement>(null);
  const startedBox = useRef<HTMLParagraphElement>(null);
  const reasonId = useId();
  useEffect(() => {
    if (started) startedBox.current?.focus();
  }, [started]);
  // Once started the button is gone (the new run is not failed): the note takes its place and the focus.
  if (started) {
    return (
      <p role="status" ref={startedBox} tabIndex={-1} className="text-sm" data-started>
        {t("runUi.again.started")}
      </p>
    );
  }
  if (!state.show) return null;
  const { off } = state;
  const start = async () => {
    setRefused(null);
    const result = await store.hostRequest(hostId, "card.start", {
      cardId,
      workflow: run.workflowName,
      inputs: run.inputs,
    });
    if (!result.ok) {
      setRefused(refusalText(result.code, result.message, t, result));
      refusedBox.current?.focus();
      return;
    }
    setStarted(true);
  };
  return (
    <Stack gap={2}>
      <div>
        <ActionButton
          variant="outline"
          size="sm"
          disabled={off !== null}
          aria-describedby={off ? reasonId : undefined}
          onClick={start}
        >
          {t("runUi.again.action")}
        </ActionButton>
      </div>
      {off && (
        <p id={reasonId} className="text-muted-foreground text-xs">
          {t(`runUi.again.${off}` as Key, { name: run.workflowName })}
        </p>
      )}
      {off !== null && off !== "loading" && (
        <div>
          <Button variant="link" size="sm" onClick={props.onOpenWorkflows}>
            {t("runUi.again.openWorkflows")}
          </Button>
        </div>
      )}
      <div
        role="alert"
        ref={refusedBox}
        tabIndex={-1}
        className="rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
      >
        {refused && <p className="text-sm">{refused}</p>}
      </div>
    </Stack>
  );
}
