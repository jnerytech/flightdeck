import type { RunResumeCheck, WorkflowInfo, WorkflowRun } from "@flightdeck/protocol";
import { useEffect, useId, useRef, useState } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { Inline, Stack } from "@/components/layout/stack";
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
 *
 * Issue #1266: when the host's check says the run can go on from its failed step (`run.resume`),
 * "Run again from <step>" comes first; otherwise the check's reason is said under "Run again". A
 * host without the command answers the check with an error, and only "Run again" is offered.
 */
export function RunAgain(props: Readonly<RunAgainProps>) {
  // Keyed by the run: the next failed run of the card starts with a clean state, not the last one's note.
  return <RunAgainOf key={props.run.id} {...props} />;
}

function RunAgainOf(props: Readonly<RunAgainProps>) {
  const { store, hostId, cardId, run } = props;
  const { t } = store.i18n;
  const state = runAgain(run, props.workflow, props.known);
  const [refused, setRefused] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [check, setCheck] = useState<RunResumeCheck | null>(null);
  // The resume keeps the run's id: its note stays while the run runs, until it ends again.
  const [resumed, setResumed] = useState<{ from: string; end: string | null } | null>(null);
  // One request at a time: a resume and a start of the same card would race each other.
  const [busy, setBusy] = useState<"start" | "resume" | null>(null);
  const refusedBox = useRef<HTMLDivElement>(null);
  const startedBox = useRef<HTMLOutputElement>(null);
  const reasonId = useId();
  const resumeReasonId = useId();
  const going = resumed !== null && (run.status !== "failed" || run.endedAt === resumed.end);
  // Only when "Run again" is on: a file that is the problem keeps its own reason.
  const checkFor = state.show && state.off === null && !going ? `${run.id}@${run.endedAt}` : null;
  useEffect(() => {
    if (started || going) startedBox.current?.focus();
  }, [started, going]);
  useEffect(() => {
    setCheck(null);
    if (checkFor === null) return;
    let live = true;
    // The check only advises: a failed request offers "Run again" alone.
    void store
      .hostRequest(hostId, "run.resume", { runId: run.id })
      .then((answer) => {
        if (live && answer.ok) setCheck(answer.data);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [checkFor, store, hostId, run.id]);
  // Once started the button is gone (the new run is not failed): the note takes its place and the focus.
  if (started || going) {
    return (
      <output ref={startedBox} tabIndex={-1} className="block text-sm" data-started>
        {resumed && going
          ? t("runUi.again.resumed", { step: resumed.from })
          : t("runUi.again.started")}
      </output>
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
  const resume = async () => {
    setRefused(null);
    const end = run.endedAt;
    const result = await store.hostRequest(hostId, "run.resume", { runId: run.id, confirm: true });
    const refusal = () => {
      if (!result.ok) return result;
      return result.data.ok ? null : result.data;
    };
    const no = refusal();
    if (no) {
      if (result.ok) setCheck(result.data);
      setRefused(refusalText(result.ok ? "invalid_state" : result.code, "", t, no));
      refusedBox.current?.focus();
      return;
    }
    if (result.ok) setResumed({ from: result.data.from, end });
  };
  const one = (which: "start" | "resume", work: () => Promise<void>) => async () => {
    setBusy(which);
    try {
      await work();
    } finally {
      setBusy(null);
    }
  };
  const offer = off === null && check?.ok === true ? check.from : null;
  // "Only a failed run" says nothing new on a failed run: the check raced its end.
  const why =
    off === null && check && !check.ok && check.reason !== "run_resume_not_failed" && !refused
      ? refusalText("invalid_state", "", t, check)
      : null;
  const whyId = why ? resumeReasonId : undefined;
  return (
    <Stack gap={2}>
      <Inline gap={2}>
        {offer !== null && (
          <ActionButton
            variant="outline"
            size="sm"
            disabled={busy === "start"}
            onClick={one("resume", resume)}
          >
            {t("runUi.again.resume", { step: offer })}
          </ActionButton>
        )}
        <ActionButton
          variant="outline"
          size="sm"
          disabled={off !== null || busy === "resume"}
          aria-describedby={off ? reasonId : whyId}
          onClick={one("start", start)}
        >
          {t("runUi.again.action")}
        </ActionButton>
      </Inline>
      {why && (
        <p id={resumeReasonId} className="text-muted-foreground text-xs">
          {why}
        </p>
      )}
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
