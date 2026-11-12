import type { Database } from "bun:sqlite";
import type { Config } from "../config.ts";
import { type DomainModule, serverGroup } from "../server/index.ts";
import { inspectProject } from "./inspect.ts";
import { ProjectTrust } from "./project-trust.ts";

/** What the `project.trust` service reads besides the trust records. */
interface TrustServerDeps {
  projectTrust: ProjectTrust;
  manager: {
    /** The live sessions in the folder that loaded a setup it no longer trusts. */
    staleSessions(path: string): number;
    trustChanged(): void;
  };
}

/** Issue #196 (issue #1593): the `project.trust` service: a folder's trust, read and set. */
function trustServer({ projectTrust, manager }: TrustServerDeps) {
  /** A folder's trust as the clients see it, with the live sessions that still run with the setup they loaded (issue #463). */
  const trustState = (path: string) => {
    const staleSessions = manager.staleSessions(path);
    return { path, ...projectTrust.judged(path), ...(staleSessions > 0 ? { staleSessions } : {}) };
  };
  return {
    refresh: (paths?: readonly string[]) => projectTrust.refresh(paths),
    state: (paths: string[]) => paths.map(trustState),
    inspect: (path: string) => inspectProject(path),
    set: (path: string, trusted: boolean) => {
      if (trusted) projectTrust.trust(path);
      else projectTrust.revoke(path);
      // The live sessions that loaded the setup say again whether it is still theirs (issue #463).
      manager.trustChanged();
      return trustState(path);
    },
  };
}

/** What the `projects` group is built from besides the trust service's deps (issue #1593). */
interface ProjectsDeps extends TrustServerDeps {
  /** A folder's project key, read through git once and kept. */
  keys: { resolve(cwd: string): Promise<string> };
}

/**
 * Issue #1593: the `projects` group as a module: a folder's project key (warmed and read), its
 * trust, and "find my projects". No start and no stop.
 */
export function createProjects({ keys, ...trust }: ProjectsDeps): {
  modules: readonly [DomainModule<"projects">];
} {
  const projects = serverGroup<"projects">()({
    warmKey: (cwd) => keys.resolve(cwd),
    keyOf: (cwd) => keys.resolve(cwd),
    trust: trustServer(trust),
    find: true,
  });
  return { modules: [{ server: { projects } }] as const };
}

/** What a folder's trust is built from (issue #1593). */
export interface ProjectTrustDeps {
  db: Database;
  /** Read at each call: a root added from the app counts at once. */
  config: Pick<Config, "allowedRoots">;
  /** The board's lookup; the board is made later, so the call is bound late. */
  projectForCwd(cwd: string): { project: { path: string }; card: object | null } | null;
  log(line: string): void;
}

/**
 * Whether a folder's own hooks, MCP servers and settings may load in a session (issue #196): only
 * where the person trusted it (or already worked in it before this existed). A card's worktree is
 * read from its project's main checkout.
 */
export function createProjectTrust({ db, config, projectForCwd, log }: ProjectTrustDeps) {
  const projectTrust = new ProjectTrust(db, {
    roots: () => config.allowedRoots,
    configRootOf: (cwd) => {
      const found = projectForCwd(cwd);
      return found?.card ? found.project.path : null;
    },
    log,
  });
  // The library's index (#76) goes to a trusted folder only, read from its trusted checkout.
  const trustForKnowledge = async (path: string) => {
    await projectTrust.prepare(path);
    return projectTrust.sessionTrust(path);
  };
  return { projectTrust, trustForKnowledge };
}
