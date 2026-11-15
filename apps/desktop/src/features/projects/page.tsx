import type { ProjectListResult } from "@flightdeck/protocol";
import { FolderGit2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMinLoading } from "@/shared/hooks/index.ts";
import { EmptyState, LoadingState, Page, Panel } from "@/shared/layout/index.ts";
import type { AppStore } from "../../lib/app-store.ts";
import { hasFeature } from "../../lib/version.ts";
import { RulesSection } from "../permissions/ui.ts";
import { FindProjects } from "./find-projects.tsx";
import { ProjectForm } from "./project-form.tsx";
import { ProjectRow } from "./project-row.tsx";
import { ProjectsPicker } from "./projects-picker.tsx";
import { StartFromGithub } from "./start-from-github.tsx";

/** Projects of one host (register and edit) and the host's limit of parallel runs. */
export function ProjectsPage(
  props: Readonly<{
    store: AppStore;
    hostId: string;
    hostName: string;
    onOpenBoard(projectId: string): void;
    onOpenWorkflows(project: { id: string; name: string }): void;
    /** The host announces `automation` (phase 13): each project's Automações. */
    automations: boolean;
    onOpenAutomations(project: { id: string; name: string }): void;
    /** The host announces `actions` (phase 17): each project's Ações. */
    actions: boolean;
    onOpenActions(project: { id: string; name: string }): void;
    /** The host announces `rules`: the project's Regras section. */
    rules: boolean;
    /** The host announces `agentcfg` (phase 12): the project's Agente screen. */
    agent: boolean;
    /** The host announces `personas` (phase 20): a default persona per board column. */
    personas?: boolean;
    onOpenAgent(project: { id: string; name: string }): void;
    /** Only the picker for Board or Workflows (a nav item with several projects). */
    focus?: "board" | "workflows";
  }>,
) {
  const { store, hostId } = props;
  const [list, setList] = useState<ProjectListResult | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  // Another Edit click starts the form over from that project: it gets a new key.
  const [round, setRound] = useState(0);
  const [limit, setLimit] = useState("");
  const loading = useMinLoading(list === null);
  const { t } = props.store.i18n;
  const pathField = useRef<HTMLInputElement>(null);
  const host = store.getState().hosts.find((h) => h.id === hostId);

  const reload = useCallback(async () => {
    const result = await store.hostCommand(hostId, "project.list", {});
    if (result) {
      setList(result);
      setLimit(String(result.maxParallelRuns));
      store.projectList.remember(hostId, result.projects);
    }
  }, [store, hostId]);

  useEffect(() => {
    void reload();
  }, [reload]);
  /** What a project added or started from here does: the list is read again. */
  const reloaded = () => void reload();

  if (props.focus) {
    return (
      <ProjectsPicker
        store={store}
        hostId={hostId}
        hostName={props.hostName}
        focus={props.focus}
        list={list}
        loading={loading}
        onOpenBoard={props.onOpenBoard}
        onOpenWorkflows={props.onOpenWorkflows}
        onChanged={reloaded}
      />
    );
  }

  return (
    <Page title={t("projectsUi.title", { host: props.hostName })}>
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
        <div className="button-row">
          {host && hasFeature(host.hostInfo?.features, "projects.scan", false) && (
            <FindProjects store={store} hostId={hostId} onAdded={reloaded} />
          )}
          {host && hasFeature(host.hostInfo?.features, "github", false) && (
            <StartFromGithub store={store} hostId={hostId} onStarted={reloaded} />
          )}
        </div>
        <ul aria-label={t("projectsUi.list")} className="flex flex-col gap-2">
          {(list?.projects ?? []).map((project) => (
            <ProjectRow
              key={project.id}
              store={store}
              hostId={hostId}
              project={project}
              agent={props.agent}
              actions={props.actions}
              automations={props.automations}
              onOpenBoard={props.onOpenBoard}
              onOpenWorkflows={props.onOpenWorkflows}
              onOpenAgent={props.onOpenAgent}
              onOpenActions={props.onOpenActions}
              onOpenAutomations={props.onOpenAutomations}
              onEdit={(p) => {
                setEditing(p.id);
                setRound((n) => n + 1);
              }}
            />
          ))}
        </ul>
        <ProjectForm
          key={round}
          store={store}
          hostId={hostId}
          host={host}
          editing={editing}
          project={list?.projects.find((p) => p.id === editing)}
          personas={props.personas}
          pathField={pathField}
          onSaved={() => {
            setEditing(null);
            reloaded();
          }}
        />
        {editing && props.rules && (
          <RulesSection key={editing} store={store} hostId={hostId} projectId={editing} />
        )}
        <Panel title={t("projectsUi.hostLimit")}>
          <div className="flex items-center gap-2">
            <Input
              aria-label={t("projectsUi.parallel")}
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
              {t("projectsUi.saveLimit")}
            </Button>
          </div>
        </Panel>
      </div>
    </Page>
  );
}
