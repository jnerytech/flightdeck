import type { CommandPayload, CommandResults, Project } from "@flightdeck/protocol";
import { hasFeature } from "../../lib/version.ts";
import { probeAfter, type SetupProbe } from "./domain/setup-steps.ts";

/** The requests a look at a host makes for the setup checklist. */
type ProbeRequest = "hooks.status" | "github.status" | "project.list";

/** What the setup probes read and ask through the app's store. */
export interface SetupProbesCore {
  /** A host the app knows: its status and the features its `host.info` listed. */
  host(hostId: string): { status: string; features: readonly string[] | undefined } | undefined;
  /** Whether the screens' project list of the host is read already. */
  projectsRead(hostId: string): boolean;
  /** Asks the host; a refusal comes back instead of going to the banner (the kernel's type is in an import cycle, #1624). */
  request<C extends ProbeRequest>(
    hostId: string,
    type: C,
    payload: CommandPayload<C>,
  ): Promise<{ ok: true; data: CommandResults[C] } | { ok: false }>;
  /** The host's projects, kept as the list the screens use. */
  rememberProjects(hostId: string, projects: Project[]): void;
  /** What each host answered so far. */
  probes(): Record<string, SetupProbe>;
  setProbes(probes: Record<string, SetupProbe>): void;
}

/**
 * What the setup checklist asks of a host: its hooks, GitHub only when asked, and its projects when
 * they are not read yet. A look from the Setup screen or a host page reads them for the checklist
 * only; the one at connect also opens the list the screens use (see `SetupProbes.refresh`).
 */
function setupWants(
  features: readonly string[] | undefined,
  projectsRead: boolean,
  githubAsked: boolean,
) {
  return {
    hooks: hasFeature(features, "central", false),
    github: githubAsked && hasFeature(features, "github", false),
    projects: !projectsRead && hasFeature(features, "workflows", false),
  };
}

/**
 * What the setup checklist knows of each host (#1596: a slice of the store): its hooks, GitHub and
 * projects, asked at connect and from the Setup screen or a host page.
 */
export class SetupProbes {
  constructor(private readonly core: SetupProbesCore) {}

  /**
   * Asks a host what the setup checklist reads: its hooks and its projects, at connect. GitHub runs
   * `gh auth status` on the host, so it is asked only with `github` (the Setup screen, the GitHub
   * panel); what it said last stays until then.
   */
  async refresh(
    hostId: string,
    options: { github?: boolean; connect?: boolean } = {},
  ): Promise<void> {
    const host = this.core.host(hostId);
    if (host?.status !== "online") return;
    const wants = setupWants(
      host.features,
      options.connect !== true && this.core.projectsRead(hostId),
      options.github === true,
    );
    const { hooks: wantsHooks, github: wantsGithub, projects: wantsProjects } = wants;
    if (!wantsHooks && !wantsGithub && !wantsProjects) return;
    const [hooks, github, projects] = await Promise.all([
      wantsHooks ? this.core.request(hostId, "hooks.status", {}) : null,
      wantsGithub ? this.core.request(hostId, "github.status", {}) : null,
      wantsProjects ? this.core.request(hostId, "project.list", {}) : null,
    ]);
    // The host may have gone while it was asked.
    if (!this.core.host(hostId)) return;
    // At connect the probe's list is also the screens' (the sidebar tree needs it on any page, #721):
    // one request, not two.
    if (options.connect === true && wantsProjects && projects?.ok) {
      this.core.rememberProjects(hostId, projects.data.projects);
    }
    const probe = probeAfter(this.core.probes()[hostId], wants, { hooks, github, projects });
    this.core.setProbes({ ...this.core.probes(), [hostId]: probe });
  }
}
