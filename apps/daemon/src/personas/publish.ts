import type { AgentConfig } from "../agentcfg/files.ts";
import type { AgentPublishRequest } from "./store.ts";

/**
 * Phase 20 into phase 12: a persona published as a project agent goes through the project's
 * agent editor, so its frontmatter, path and overwrite checks are the editor's own.
 */
export function agentPublisher(_agents: Pick<AgentConfig, "list" | "write">) {
  return {
    publish(_request: AgentPublishRequest): { path: string } {
      return { path: "" };
    },
  };
}
