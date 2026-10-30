import type { WorkflowInfo } from "@flightdeck/protocol";
import { useCallback, useEffect, useState } from "react";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { Page } from "@/components/layout/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import type { T } from "../i18n/index.ts";
import type { AppStore } from "../lib/app-store.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

/** What trusting a workflow allows, said before the user confirms it. */
function trustMessage(workflow: WorkflowInfo, t: T): string {
  const commands = workflow.checks.join("; ") || t("workflowsUi.none");
  return t("workflowsUi.trustMessage", { name: workflow.name, commands });
}

/**
 * Workflows of a project, as they are on its base branch: validation, the `check` commands each
 * can run and the button that trusts it (after showing those commands).
 */
export function WorkflowsPage(props: {
  store: AppStore;
  hostId: string;
  projectId: string;
  projectName: string;
}) {
  const t = useT();
  const { store, hostId, projectId } = props;
  const [workflows, setWorkflows] = useState<WorkflowInfo[]>([]);
  const [trusting, setTrusting] = useState<WorkflowInfo | null>(null);

  const reload = useCallback(async () => {
    const result = await store.hostCommand(hostId, "workflow.list", { projectId });
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
    >
      <ul aria-label={t("workflowsUi.list")} className="flex flex-col gap-3">
        {workflows.map((workflow) => (
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
                {workflow.errors.map((error) => (
                  <li key={error}>
                    <InlineNotice tone="error">{error}</InlineNotice>
                  </li>
                ))}
              </ul>
            )}
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
            {!workflow.trusted && workflow.errors.length === 0 && (
              <Button
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() => setTrusting(workflow)}
              >
                {t("workflowsUi.trust", { name: workflow.name })}
              </Button>
            )}
          </li>
        ))}
      </ul>
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
