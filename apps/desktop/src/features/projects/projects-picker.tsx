import type { ProjectListResult } from "@flightdeck/protocol";
import { FolderGit2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState, Page } from "@/shared/layout/index.ts";
import type { AppStore } from "../../lib/app-store.ts";
import { AddProject } from "./add-project.tsx";
import { HostBoardLanding } from "./board-landing.tsx";

/** Only the picker for Board or Workflows: a nav item of a host with several projects. */
export function ProjectsPicker(
  props: Readonly<{
    store: AppStore;
    hostId: string;
    hostName: string;
    focus: "board" | "workflows";
    /** The host's projects, or null while they are read. */
    list: ProjectListResult | null;
    loading: boolean;
    onOpenBoard(projectId: string): void;
    onOpenWorkflows(project: { id: string; name: string }): void;
    /** A project was added or started from here: the list is read again. */
    onChanged(): void;
  }>,
) {
  const { store, hostId, list, loading } = props;
  const { t } = store.i18n;
  const board = props.focus === "board";
  // The picker shows the selected client's projects; the host's own screen lists them all.
  const state = store.getState();
  const projects = store.clientScope
    .get()
    .filter(list?.projects ?? [], state.clientSelection, (p) => store.projectList.keyOf(hostId, p));
  const hidden = (list?.projects.length ?? 0) > 0 && projects.length === 0;
  return (
    <Page title={t(board ? "sidebar.boardOf" : "sidebar.workflowsOf", { host: props.hostName })}>
      {loading && <LoadingState label={t("states.loadingProjects")} />}
      {!loading && hidden && <EmptyState title={t("clients.noneHere")} />}
      {/* The Board screen of a host: its projects as cards (#669). */}
      {!loading && board && !hidden && list && (
        <HostBoardLanding
          store={store}
          hostId={hostId}
          hostName={props.hostName}
          projects={projects}
          onOpenBoard={props.onOpenBoard}
          onAdded={props.onChanged}
        />
      )}
      {!loading && !board && list?.projects.length === 0 && (
        <EmptyState
          icon={FolderGit2}
          title={t("states.emptyProjects")}
          action={<AddProject store={store} hostId={hostId} onAdded={props.onChanged} />}
        />
      )}
      {!loading && !board && (list?.projects.length ?? 0) > 0 && (
        <div>
          <AddProject store={store} hostId={hostId} variant="outline" onAdded={props.onChanged} />
        </div>
      )}
      {!board && (
        <ul aria-label={t("projectsUi.list")} className="flex flex-col">
          {projects.map((project) => (
            <li key={project.id} className="flex items-center gap-3">
              <Button variant="ghost" onClick={() => props.onOpenWorkflows(project)}>
                {t("projectsUi.workflows", { name: project.name })}
              </Button>
              <span className="text-muted-foreground text-xs">{`${project.path} · ${project.baseBranch}`}</span>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
