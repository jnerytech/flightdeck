import { RequestError } from "@/features/hosts/index.ts";
import type { AppKernel } from "../../lib/kernel.ts";
import { type ProjectsCore, ProjectsSlice } from "./store.ts";

/**
 * Builds the projects' slice from the store's kernel (#1596): the list kept in the state, the
 * quiet reads that give `null` on any failure, and a refusal shown in the banner with its host.
 */
export function wireProjects(kernel: AppKernel<ReturnType<ProjectsCore["state"]>>): ProjectsSlice {
  return new ProjectsSlice({
    state: () => kernel.state(),
    setProjects: (projects) => kernel.update({ projects }),
    quietly: async (hostId, type, payload) => {
      const conn = kernel.connection(hostId);
      return conn ? conn.request(type, payload).catch(() => null) : null;
    },
    request: (hostId, type, payload) => kernel.hostRequest(hostId, type, payload),
    refused: (hostId, { code, message, reason, params, items }) =>
      kernel.fail(new RequestError(code, message, reason, params, items, hostId)),
    success: (text) => kernel.success(text),
    t: () => kernel.t(),
  });
}
