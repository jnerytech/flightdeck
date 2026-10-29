import type { WorkflowInfo } from "@flightdeck/protocol";
import { useCallback, useEffect, useState } from "react";
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
    <section className="card workflows">
      <h2>{`Workflows de ${props.projectName}`}</h2>
      <p className="muted">Lidos de .flightdeck/workflows na branch base do projeto.</p>
      <ul aria-label="Workflows">
        {workflows.map((workflow) => (
          <li key={workflow.name} aria-label={`Workflow ${workflow.name}`}>
            <strong>{workflow.name}</strong>{" "}
            <span className="badge">{workflow.trusted ? "confiado" : "não confiado"}</span>
            {workflow.errors.length > 0 && (
              <ul aria-label={`Erros de ${workflow.name}`} className="errors">
                {workflow.errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            )}
            <ul aria-label={`Comandos de ${workflow.name}`}>
              {workflow.checks.map((command) => (
                <li key={command}>
                  <code>{command}</code>
                </li>
              ))}
            </ul>
            {!workflow.trusted && workflow.errors.length === 0 && (
              <button type="button" onClick={() => setTrusting(workflow)}>
                {`Confiar em ${workflow.name}`}
              </button>
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
    </section>
  );
}
