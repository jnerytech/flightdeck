import type { WorkflowInfo } from "@flightdeck/protocol";
import { Workflow } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import { workflowIssueText } from "@/i18n/errors";
import { ConfirmDialog, InlineNotice } from "@/shared/feedback/index.ts";
import { EmptyState, ErrorState, LoadingState, Page, Stack } from "@/shared/layout/index.ts";
import type { T } from "../../i18n/index.ts";
import type { AppStore } from "../../lib/app-store.ts";
import { useStoreSlice } from "../../lib/use-store.ts";
import { WorkflowTemplates } from "./workflow-templates.tsx";

/** An element of one workflow's card: its name (`name`) or its Trust button (`trust`). */
function pick(list: HTMLUListElement | null, workflow: string, target: "trust" | "name") {
  const item = [...(list?.children ?? [])].find(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child.dataset.workflow === workflow,
  );
  return item?.querySelector<HTMLElement>(`[data-target="${target}"]`) ?? null;
}

/** Focuses `target` of that workflow's card, or its name when the button is gone. */
function focusIn(list: HTMLUListElement | null, workflow: string, target: "trust" | "name") {
  (pick(list, workflow, target) ?? pick(list, workflow, "name"))?.focus();
}

/** What trusting a workflow allows, said before the user confirms it: each command on its own line. */
function TrustCommands(props: Readonly<{ workflow: WorkflowInfo; t: T }>) {
  const { workflow, t } = props;
  if (workflow.checks.length === 0) return <p className="text-sm">{t("workflowsUi.trustNone")}</p>;
  return (
    <Stack as="ul" gap={1} label={t("workflowsUi.trustCommands", { name: workflow.name })}>
      {workflow.checks.map((command) => (
        // A command may span lines (a YAML block): the breaks stay, so the person sees where each ends.
        // The daemon lists each command once, so the command is the key.
        <li key={command}>
          <code className="whitespace-pre-wrap break-all rounded bg-muted font-mono text-xs">
            {command}
          </code>
        </li>
      ))}
    </Stack>
  );
}

/**
 * Workflows of a project, as they are on its base branch: validation, the `check` commands each
 * can run and the button that trusts it (after showing those commands).
 */
export function WorkflowsPage(
  props: Readonly<{
    store: AppStore;
    hostId: string;
    projectId: string;
    projectName: string;
  }>,
) {
  const t = useT();
  const { store, hostId, projectId } = props;
  const { hosts } = useStoreSlice(store, ["hosts"]);
  // Only a near connection may trust a workflow (the host refuses it otherwise, #3799); a host that
  // does not say (an older one) is asked as before.
  const far = hosts.find((host) => host.id === hostId)?.hostInfo?.near === false;
  const farId = useId();
  /** Null until the host first answers. */
  const [workflows, setWorkflows] = useState<WorkflowInfo[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [trusting, setTrusting] = useState<WorkflowInfo | null>(null);
  // The workflow whose Trust is in flight (one at a time), and what the host answered to the last one.
  const [pending, setPending] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ name: string; accepted: boolean } | null>(null);
  const list = useRef<HTMLUListElement>(null);
  // A confirmed Trust removes its button when it is accepted: the focus waits on the workflow's name.
  const confirmed = useRef(false);
  // The request of a confirmed Trust has not answered yet (read when the dialog gives the focus back).
  const inFlight = useRef(false);
  // The workflow whose answer just came: once its button is back on, the focus may move there.
  const answered = useRef<string | null>(null);

  const reload = useCallback(async () => {
    // The page has its own error and Try again (the toast's retry would drop the answer).
    const result = await store.hostCommand(
      hostId,
      "workflow.list",
      { projectId },
      { retry: false },
    );
    setFailed(result === null);
    if (result) setWorkflows(result.workflows);
  }, [store, hostId, projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const trust = async (workflow: WorkflowInfo) => {
    const { name, hash } = workflow;
    confirmed.current = true;
    setTrusting(null);
    setOutcome(null);
    setPending(name);
    inFlight.current = true;
    try {
      const answer = await store.hostCommand(hostId, "workflow.trust", { projectId, name, hash });
      setOutcome({ name, accepted: answer?.trusted === true });
      await reload();
    } finally {
      answered.current = name;
      inFlight.current = false;
      setPending(null);
    }
  };

  // The answer is in and the buttons are back: Trust again after a refusal, else the workflow's name.
  // Only the page body or the name gives the focus up: a person who moved on keeps theirs.
  useEffect(() => {
    const name = answered.current;
    if (pending !== null || name === null) return;
    answered.current = null;
    const active = document.activeElement;
    if (active === document.body || active === pick(list.current, name, "name")) {
      focusIn(list.current, name, "trust");
    }
  }, [pending]);

  return (
    <Page
      title={t("workflowsUi.title", { project: props.projectName })}
      subtitle={t("workflowsUi.subtitle")}
      actions={<WorkflowTemplates store={store} hostId={hostId} projectId={projectId} />}
    >
      <div aria-live="polite" className="text-muted-foreground text-sm empty:sr-only">
        {outcome?.accepted && t("workflowsUi.trustDone", { name: outcome.name })}
      </div>
      {outcome && !outcome.accepted && (
        <InlineNotice tone="error">
          {t("workflowsUi.trustRefused", { name: outcome.name })}
        </InlineNotice>
      )}
      {failed && (
        <ErrorState
          message={t("workflowsUi.failed")}
          retryLabel={t("workflowsUi.retry")}
          onRetry={() => void reload()}
        />
      )}
      {!failed && workflows === null && <LoadingState label={t("workflowsUi.loading")} />}
      {workflows?.length === 0 && <EmptyState icon={Workflow} title={t("workflowsUi.empty")} />}
      {workflows && workflows.length > 0 && (
        <ul ref={list} aria-label={t("workflowsUi.list")} className="flex flex-col gap-3">
          {workflows.map((workflow, index) => (
            <li
              key={workflow.name}
              data-workflow={workflow.name}
              aria-label={t("workflowsUi.item", { name: workflow.name })}
              className="flex flex-col gap-2 rounded-lg border bg-card p-4 text-sm"
            >
              <div className="flex items-center gap-2">
                <strong tabIndex={-1} data-target="name">
                  {workflow.name}
                </strong>{" "}
                <Badge variant="outline">
                  {workflow.trusted ? t("workflowsUi.trusted") : t("workflowsUi.untrusted")}
                </Badge>
              </div>
              {workflow.errors.length > 0 && (
                <ul
                  aria-label={t("workflowsUi.errors", { name: workflow.name })}
                  className="flex flex-col gap-1"
                >
                  {(workflow.issues
                    ? workflow.issues.map((issue) => workflowIssueText(issue, t))
                    : workflow.errors
                  ).map((error) => (
                    <li key={error}>
                      <InlineNotice tone="error">{error}</InlineNotice>
                    </li>
                  ))}
                </ul>
              )}
              {workflow.checks.length > 0 && (
                <ul
                  aria-label={t("workflowsUi.commands", { name: workflow.name })}
                  className="flex flex-col gap-1"
                >
                  {workflow.checks.map((command) => (
                    <li key={command}>
                      <code className="rounded bg-muted px-1 font-mono text-xs">{command}</code>
                    </li>
                  ))}
                </ul>
              )}
              {!workflow.trusted && workflow.errors.length === 0 && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="self-start"
                    data-target="trust"
                    disabled={far || pending !== null}
                    aria-busy={pending === workflow.name || undefined}
                    aria-describedby={far ? `${farId}-${index}` : undefined}
                    onClick={() => {
                      // The last answer is about an earlier question: it goes when a new one opens.
                      setOutcome(null);
                      setTrusting(workflow);
                    }}
                  >
                    {t("workflowsUi.trust", { name: workflow.name })}
                  </Button>
                  {far && (
                    <p id={`${farId}-${index}`} className="text-muted-foreground text-xs">
                      {t("workflowsUi.farOnly")}
                    </p>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {trusting && (
        <ConfirmDialog
          message={t("workflowsUi.trustMessage", { name: trusting.name })}
          confirmLabel={t("workflowsUi.trustConfirm")}
          // Radix would return the focus to Trust, which an accepted Trust removes: the name stays while
          // the host answers. An answer that came first has already given the focus to Trust (or, once
          // Trust is gone, to the name): the restore must not take it back.
          onRestoreFocus={() => {
            const waiting = confirmed.current && inFlight.current;
            focusIn(list.current, trusting.name, waiting ? "name" : "trust");
            confirmed.current = false;
          }}
          onConfirm={() => void trust(trusting)}
          onCancel={() => setTrusting(null)}
        >
          <TrustCommands workflow={trusting} t={t} />
        </ConfirmDialog>
      )}
    </Page>
  );
}
