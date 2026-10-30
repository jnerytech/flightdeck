import type { WorkflowInfo } from "@flightdeck/protocol";
import { useCallback, useEffect, useState } from "react";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { Page } from "@/components/layout/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AppStore } from "../lib/app-store.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

/** What trusting a workflow allows, said before the user confirms it. */
function trustMessage(workflow: WorkflowInfo): string {
  const commands = workflow.checks.join("; ") || "nenhum";
  return `Confiar no workflow ${workflow.name}? Ele poderá rodar estes comandos na worktree dos cards: ${commands}.`;
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
      title={`Workflows de ${props.projectName}`}
      subtitle="Lidos de .flightdeck/workflows na branch base do projeto."
    >
      <ul aria-label="Workflows" className="flex flex-col gap-3">
        {workflows.map((workflow) => (
          <li
            key={workflow.name}
            aria-label={`Workflow ${workflow.name}`}
            className="flex flex-col gap-2 rounded-lg border bg-card p-4 text-sm"
          >
            <div className="flex items-center gap-2">
              <strong>{workflow.name}</strong>{" "}
              <Badge variant="outline">{workflow.trusted ? "confiado" : "não confiado"}</Badge>
            </div>
            {workflow.errors.length > 0 && (
              <ul aria-label={`Erros de ${workflow.name}`} className="flex flex-col gap-1">
                {workflow.errors.map((error) => (
                  <li key={error}>
                    <InlineNotice tone="error">{error}</InlineNotice>
                  </li>
                ))}
              </ul>
            )}
            <ul aria-label={`Comandos de ${workflow.name}`} className="flex flex-col gap-1">
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
                {`Confiar em ${workflow.name}`}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {trusting && (
        <ConfirmDialog
          message={trustMessage(trusting)}
          confirmLabel="Confiar"
          onConfirm={() => void trust(trusting)}
          onCancel={() => setTrusting(null)}
        />
      )}
    </Page>
  );
}
