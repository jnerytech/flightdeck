import type { WorkflowInfo } from "@flightdeck/protocol";
import { Workflow } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import { workflowIssueText } from "@/i18n/errors";
import { ConfirmDialog, InlineNotice } from "@/shared/feedback/index.ts";
import { EmptyState, ErrorState, LoadingState, Page } from "@/shared/layout/index.ts";
import type { T } from "../../i18n/index.ts";
import type { AppStore } from "../../lib/app-store.ts";
import { useStoreSlice } from "../../lib/use-store.ts";
import { WorkflowTemplates } from "./workflow-templates.tsx";

/** What trusting a workflow allows, said before the user confirms it. */
function trustMessage(workflow: WorkflowInfo, t: T): string {
  const commands = workflow.checks.join("; ") || t("workflowsUi.none");
  return t("workflowsUi.trustMessage", { name: workflow.name, commands });
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
    setTrusting(null);
    const { name, hash } = workflow;
    await store.hostCommand(hostId, "workflow.trust", { projectId, name, hash });
    await reload();
  };

  return (
    <Page
      title={t("workflowsUi.title", { project: props.projectName })}
      subtitle={t("workflowsUi.subtitle")}
      actions={<WorkflowTemplates store={store} hostId={hostId} projectId={projectId} />}
    >
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
        <ul aria-label={t("workflowsUi.list")} className="flex flex-col gap-3">
          {workflows.map((workflow, index) => (
            <li
              key={workflow.name}
              aria-label={t("workflowsUi.item", { name: workflow.name })}
              className="flex flex-col gap-2 rounded-lg border bg-card p-4 text-sm"
            >
              <div className="flex items-center gap-2">
                <strong>{workflow.name}</strong>{" "}
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
                    disabled={far}
                    aria-describedby={far ? `${farId}-${index}` : undefined}
                    onClick={() => setTrusting(workflow)}
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
          message={trustMessage(trusting, t)}
          confirmLabel={t("workflowsUi.trustConfirm")}
          onConfirm={() => void trust(trusting)}
          onCancel={() => setTrusting(null)}
        />
      )}
    </Page>
  );
}
