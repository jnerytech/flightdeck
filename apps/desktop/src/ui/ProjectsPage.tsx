import type { Project, ProjectListResult, PrProviderKind } from "@flightdeck/protocol";
import { useCallback, useEffect, useState } from "react";
import type { AppStore } from "../lib/app-store.ts";
import { RulesSection } from "./RulesSection.tsx";
import { TerminalButton } from "./TerminalButton.tsx";

interface Draft {
  path: string;
  name: string;
  baseBranch: string;
  prProvider: PrProviderKind;
  setupScript: string;
  promptTemplate: string;
}

const EMPTY: Draft = {
  path: "",
  name: "",
  baseBranch: "",
  prProvider: "none",
  setupScript: "",
  promptTemplate: "",
};

const fromProject = (p: Project): Draft => ({
  path: p.path,
  name: p.name,
  baseBranch: p.baseBranch,
  prProvider: p.prProvider,
  setupScript: p.setupScript ?? "",
  promptTemplate: p.promptTemplate,
});

/** Projects of one host (register and edit) and the host's limit of parallel runs. */
export function ProjectsPage(props: {
  store: AppStore;
  hostId: string;
  hostName: string;
  onOpenBoard(projectId: string): void;
  onOpenWorkflows(project: { id: string; name: string }): void;
  /** The host announces `rules`: the project's Regras section. */
  rules: boolean;
}) {
  const { store, hostId } = props;
  const [list, setList] = useState<ProjectListResult | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [limit, setLimit] = useState("");

  const reload = useCallback(async () => {
    const result = await store.hostCommand(hostId, "project.list", {});
    if (result) {
      setList(result);
      setLimit(String(result.maxParallelRuns));
    }
  }, [store, hostId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const submit = async () => {
    // Blank name and base branch keep the daemon's defaults (folder name, current branch).
    const fields = {
      ...(draft.name.trim() ? { name: draft.name.trim() } : {}),
      ...(draft.baseBranch.trim() ? { baseBranch: draft.baseBranch.trim() } : {}),
      prProvider: draft.prProvider,
      setupScript: draft.setupScript,
    };
    const saved = editing
      ? await store.hostCommand(hostId, "project.update", {
          projectId: editing,
          ...fields,
          promptTemplate: draft.promptTemplate,
        })
      : await store.hostCommand(hostId, "project.add", {
          path: draft.path,
          ...fields,
          // Blank keeps the default template.
          ...(draft.promptTemplate.trim() ? { promptTemplate: draft.promptTemplate } : {}),
        });
    if (saved) {
      setEditing(null);
      setDraft(EMPTY);
      await reload();
    }
  };

  const field = (key: keyof Draft) => ({
    value: draft[key],
    onChange: (e: { target: { value: string } }) => setDraft({ ...draft, [key]: e.target.value }),
  });

  return (
    <section className="card projects">
      <h2>{`Projetos de ${props.hostName}`}</h2>
      <ul aria-label="Projetos">
        {(list?.projects ?? []).map((project) => (
          <li key={project.id}>
            <button type="button" onClick={() => props.onOpenBoard(project.id)}>
              {`Abrir board de ${project.name}`}
            </button>
            <span className="muted">{`${project.path} · ${project.baseBranch}`}</span>
            <TerminalButton
              store={store}
              hostId={hostId}
              target={{ cwd: project.path, claudeSessionId: null }}
              name={project.name}
            />
            <button type="button" onClick={() => props.onOpenWorkflows(project)}>
              {`Workflows de ${project.name}`}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(project.id);
                setDraft(fromProject(project));
              }}
            >
              {`Editar ${project.name}`}
            </button>
          </li>
        ))}
      </ul>
      <h3>{editing ? "Editar projeto" : "Novo projeto"}</h3>
      <div className="form">
        <input
          aria-label="Caminho do repositório"
          placeholder="Caminho (dentro de allowedRoots)"
          disabled={editing !== null}
          {...field("path")}
        />
        <input aria-label="Nome" placeholder="Nome" {...field("name")} />
        <input aria-label="Branch base" placeholder="Branch base" {...field("baseBranch")} />
        <select aria-label="Provedor de PR" {...field("prProvider")}>
          <option value="none">Sem PR</option>
          <option value="github">GitHub (gh)</option>
          <option value="azure-devops">Azure DevOps (az)</option>
        </select>
        <input
          aria-label="Script de preparação"
          placeholder="Script de preparação (opcional)"
          {...field("setupScript")}
        />
        <textarea
          aria-label="Modelo de instruções"
          placeholder="Instruções anexadas ao prompt de todo card"
          {...field("promptTemplate")}
        />
        <button type="button" className="primary" onClick={() => void submit()}>
          {editing ? "Salvar projeto" : "Cadastrar projeto"}
        </button>
      </div>
      {editing && props.rules && (
        <RulesSection key={editing} store={store} hostId={hostId} projectId={editing} />
      )}
      <h3>Limite do host</h3>
      <div className="row">
        <input
          aria-label="Execuções em paralelo"
          type="number"
          min={1}
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
        />
        <button
          type="button"
          onClick={() =>
            void store.hostCommand(hostId, "board.settings", { maxParallelRuns: Number(limit) })
          }
        >
          Salvar limite
        </button>
      </div>
    </section>
  );
}
