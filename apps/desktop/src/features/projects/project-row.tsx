import type { Project } from "@flightdeck/protocol";
import { Button } from "@/components/ui/button";
import type { AppStore } from "../../lib/app-store.ts";
import { TerminalButton } from "../terminal/ui.ts";

/** A project on the host's screen: its name and path, then what to open from it, and Edit. */
export function ProjectRow(
  props: Readonly<{
    store: AppStore;
    hostId: string;
    project: Project;
    /** The host announces `agentcfg` (phase 12): the project's Agent screen. */
    agent: boolean;
    /** The host announces `actions` (phase 17): the project's Actions. */
    actions: boolean;
    /** The host announces `automation` (phase 13): the project's Automations. */
    automations: boolean;
    onOpenBoard(projectId: string): void;
    onOpenWorkflows(project: { id: string; name: string }): void;
    onOpenAgent(project: { id: string; name: string }): void;
    onOpenActions(project: { id: string; name: string }): void;
    onOpenAutomations(project: { id: string; name: string }): void;
    onEdit(project: Project): void;
  }>,
) {
  const { store, hostId, project } = props;
  const { t } = store.i18n;
  return (
    <li data-slot="project-row" className="project-row">
      <div data-slot="project-head" className="project-head">
        <Button
          variant="ghost"
          size="sm"
          aria-label={t("projectsUi.openBoard", { name: project.name })}
          onClick={() => props.onOpenBoard(project.id)}
        >
          {project.name}
        </Button>
        <span data-slot="project-path" className="project-path">
          {`${project.path} · ${project.baseBranch}`}
        </span>
      </div>
      <div data-slot="project-actions" className="button-row">
        <TerminalButton
          store={store}
          hostId={hostId}
          target={{ cwd: project.path, claudeSessionId: null }}
          name={project.name}
        />
        <Button
          variant="ghost"
          size="sm"
          aria-label={t("projectsUi.workflows", { name: project.name })}
          onClick={() => props.onOpenWorkflows(project)}
        >
          {t("projectsUi.short.workflows")}
        </Button>
        {props.agent && (
          <Button
            variant="ghost"
            size="sm"
            aria-label={t("agent.open", { name: project.name })}
            onClick={() => props.onOpenAgent(project)}
          >
            {t("projectsUi.short.agent")}
          </Button>
        )}
        {props.actions && (
          <Button
            variant="ghost"
            size="sm"
            aria-label={t("projectsUi.actions", { name: project.name })}
            onClick={() => props.onOpenActions(project)}
          >
            {t("projectsUi.short.actions")}
          </Button>
        )}
        {props.automations && (
          <Button
            variant="ghost"
            size="sm"
            aria-label={t("projectsUi.automations", { name: project.name })}
            onClick={() => props.onOpenAutomations(project)}
          >
            {t("projectsUi.short.automations")}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          aria-label={t("projectsUi.edit", { name: project.name })}
          onClick={() => props.onEdit(project)}
        >
          {t("projectsUi.short.edit")}
        </Button>
      </div>
    </li>
  );
}
