import type {
  CommandPayload,
  CommandResults,
  Project,
  ProjectDetectResult,
} from "@flightdeck/protocol";
import type { Key, T } from "../../i18n/index.ts";
import type { AppState, HostCommandType, HostResult } from "../../lib/app-store.ts";

type ProjectsState = Pick<AppState, "hosts" | "projects">;

/** What the projects read and ask through the app's store. */
export interface ProjectsCore {
  /** What the app holds about hosts and their projects. */
  state(): ProjectsState;
  /** Replaces the projects the app holds, as one change. */
  setProjects(projects: AppState["projects"]): void;
  /** A command to a host that gives null instead of an error (a host without it, or offline). */
  quietly<C extends HostCommandType>(
    hostId: string,
    type: C,
    payload: CommandPayload<C>,
  ): Promise<CommandResults[C] | null>;
  /** A command to a host whose refusal comes back with its code, not to the banner. */
  request<C extends HostCommandType>(
    hostId: string,
    type: C,
    payload: CommandPayload<C>,
  ): Promise<HostResult<CommandResults[C]>>;
  /** Says a refusal of the host to the person. */
  refused(hostId: string, refusal: Extract<HostResult<unknown>, { ok: false }>): void;
  success(text: string): void;
  t(): T;
}

/** The list with this project in the place of the one of its id, or at the end when it was not there. */
function replaceOrAdd(projects: Project[], project: Project): Project[] {
  return projects.some((one) => one.id === project.id)
    ? projects.map((one) => (one.id === project.id ? project : one))
    : [...projects, project];
}

/**
 * The projects each host lists (#1596: a slice of the store): the list the palette and the sidebar
 * tree read, the key a project has across hosts, and the PR provider a host reads from its remote.
 */
export class ProjectsSlice {
  constructor(private readonly core: ProjectsCore) {}

  /** A host's projects into the state (quiet: a host without a board, or offline, lists none). */
  async load(hostId: string): Promise<Project[] | null> {
    const list = await this.core.quietly(hostId, "project.list", {});
    if (!list) return null;
    this.remember(hostId, list.projects);
    return list.projects;
  }

  /** Keeps a host's projects in the state: the palette lists them, and clients place them. */
  remember(hostId: string, projects: Project[]): void {
    this.core.setProjects({ ...this.core.state().projects, [hostId]: projects });
  }

  /** The key of a project of a host: the daemon's, else the one its folder would have. */
  keyOf(hostId: string, project: Project): string {
    const host = this.core.state().hosts.find((h) => h.id === hostId);
    return project.projectKey ?? `host:${host?.name ?? hostId}:${project.path}`;
  }

  /**
   * Issue #1568: asks the host to read a project's PR provider from its remote; null when it
   * refuses. `report` is a press of the person's: a host that cannot answer, or finds nothing yet,
   * is said.
   */
  async detectProvider(
    hostId: string,
    projectId: string,
    report = false,
  ): Promise<ProjectDetectResult | null> {
    const result = await this.core.request(hostId, "project.detectProvider", { projectId });
    if (!result.ok) {
      if (report) this.core.refused(hostId, result);
      return null;
    }
    const { project, outcome } = result.data;
    const { projects } = this.core.state();
    this.core.setProjects({
      ...projects,
      [hostId]: replaceOrAdd(projects[hostId] ?? [], project),
    });
    const t = this.core.t();
    // The button that appears is not a surprise: the change is said.
    if (outcome === "set")
      this.core.success(
        t("cardUi.providerDetected", {
          provider: t(`cardUi.providerName.${project.prProvider}` as Key),
        }),
      );
    else if (report && outcome === "no_remote") this.core.success(t("cardUi.remoteNone"));
    return result.data;
  }
}
