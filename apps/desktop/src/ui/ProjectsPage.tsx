import type { Project, ProjectListResult, PrProviderKind } from "@flightdeck/protocol";
import { FolderGit2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Page } from "@/components/layout/page";
import { Panel } from "@/components/layout/panel";
import { EmptyState, LoadingState } from "@/components/layout/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useMinLoading } from "@/hooks/use-min-loading";
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
  /** Only the picker for Board or Workflows (a nav item with several projects). */
  focus?: "board" | "workflows";
}) {
  const { store, hostId } = props;
  const [list, setList] = useState<ProjectListResult | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [limit, setLimit] = useState("");
  const loading = useMinLoading(list === null);
  const { t } = props.store.i18n;
  const pathField = useRef<HTMLInputElement>(null);

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

  if (props.focus) {
    const board = props.focus === "board";
    return (
      <Page title={t(board ? "sidebar.boardOf" : "sidebar.workflowsOf", { host: props.hostName })}>
        {loading && <LoadingState label={t("states.loadingProjects")} />}
        {!loading && list?.projects.length === 0 && (
          <EmptyState title={t("states.emptyProjects")} />
        )}
        <ul aria-label="Projetos" className="flex flex-col">
          {(list?.projects ?? []).map((project) => (
            <li key={project.id} className="flex items-center gap-3">
              <Button
                variant="ghost"
                onClick={() =>
                  board ? props.onOpenBoard(project.id) : props.onOpenWorkflows(project)
                }
              >
                {board ? `Abrir board de ${project.name}` : `Workflows de ${project.name}`}
              </Button>
              <span className="text-muted-foreground text-xs">{`${project.path} · ${project.baseBranch}`}</span>
            </li>
          ))}
        </ul>
      </Page>
    );
  }

  const SELECT =
    "h-9 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <Page title={`Projetos de ${props.hostName}`}>
      <div className="flex max-w-3xl flex-col gap-6">
        {loading && <LoadingState label={t("states.loadingProjects")} />}
        {!loading && list?.projects.length === 0 && (
          <EmptyState
            icon={FolderGit2}
            title={t("states.emptyProjects")}
            action={
              <Button onClick={() => pathField.current?.focus()}>{t("states.addProject")}</Button>
            }
          />
        )}
        <ul aria-label="Projetos" className="flex flex-col gap-2">
          {(list?.projects ?? []).map((project) => (
            <li
              key={project.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm"
            >
              <Button variant="ghost" size="sm" onClick={() => props.onOpenBoard(project.id)}>
                {`Abrir board de ${project.name}`}
              </Button>
              <span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">{`${project.path} · ${project.baseBranch}`}</span>
              <TerminalButton
                store={store}
                hostId={hostId}
                target={{ cwd: project.path, claudeSessionId: null }}
                name={project.name}
              />
              <Button variant="ghost" size="sm" onClick={() => props.onOpenWorkflows(project)}>
                {`Workflows de ${project.name}`}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditing(project.id);
                  setDraft(fromProject(project));
                }}
              >
                {`Editar ${project.name}`}
              </Button>
            </li>
          ))}
        </ul>
        <Panel title={editing ? "Editar projeto" : "Novo projeto"}>
          <Input
            ref={pathField}
            aria-label="Caminho do repositório"
            placeholder="Caminho (dentro de allowedRoots)"
            disabled={editing !== null}
            {...field("path")}
          />
          <Input aria-label="Nome" placeholder="Nome" {...field("name")} />
          <Input aria-label="Branch base" placeholder="Branch base" {...field("baseBranch")} />
          <select aria-label="Provedor de PR" className={SELECT} {...field("prProvider")}>
            <option value="none">Sem PR</option>
            <option value="github">GitHub (gh)</option>
            <option value="azure-devops">Azure DevOps (az)</option>
          </select>
          <Input
            aria-label="Script de preparação"
            placeholder="Script de preparação (opcional)"
            {...field("setupScript")}
          />
          <Textarea
            aria-label="Modelo de instruções"
            placeholder="Instruções anexadas ao prompt de todo card"
            {...field("promptTemplate")}
          />
          <Button className="self-start" onClick={() => void submit()}>
            {editing ? "Salvar projeto" : "Cadastrar projeto"}
          </Button>
        </Panel>
        {editing && props.rules && (
          <RulesSection key={editing} store={store} hostId={hostId} projectId={editing} />
        )}
        <Panel title="Limite do host">
          <div className="flex items-center gap-2">
            <Input
              aria-label="Execuções em paralelo"
              type="number"
              min={1}
              className="w-28"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
            />
            <Button
              variant="outline"
              onClick={() =>
                void store.hostCommand(hostId, "board.settings", {
                  maxParallelRuns: Number(limit),
                })
              }
            >
              Salvar limite
            </Button>
          </div>
        </Panel>
      </div>
    </Page>
  );
}
