import { inspectProject } from "./inspect.ts";
import type { ProjectTrust } from "./project-trust.ts";

/** What the `project.trust` service reads besides the trust records. */
export interface TrustServerDeps {
  projectTrust: ProjectTrust;
  manager: {
    /** The live sessions in the folder that loaded a setup it no longer trusts. */
    staleSessions(path: string): number;
    trustChanged(): void;
  };
}

/** Issue #196 (issue #1593): the `project.trust` service: a folder's trust, read and set. */
export function trustServer({ projectTrust, manager }: TrustServerDeps) {
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
