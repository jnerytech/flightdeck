import type { AgentConfig } from "../agentcfg/files.ts";
import type { AgentPublishRequest } from "./store.ts";

const quoted = (value: string) => JSON.stringify(value);

/** The agent file: the frontmatter the agent editor checks, then the persona's text. */
function agentFile(request: AgentPublishRequest): string {
  const lines = ["---", `name: ${request.name}`, `description: ${quoted(request.description)}`];
  if (request.tools?.length) lines.push(`tools: ${request.tools.join(", ")}`);
  if (request.model) lines.push(`model: ${request.model}`);
  lines.push("---", request.prompt, "");
  return lines.join("\n");
}

/**
 * Phase 20 into phase 12: a persona published as a project agent goes through the project's
 * agent editor, so its frontmatter, path and overwrite checks are the editor's own.
 */
export function agentPublisher(agents: Pick<AgentConfig, "list" | "write">) {
  return {
    publish(request: AgentPublishRequest): { path: string } {
      const path = `.claude/agents/${request.name}.md`;
      // Publishing again replaces the agent: the editor asks for the hash it would overwrite.
      const current = agents
        .list(request.projectPath, "agent")
        .find((item) => item.origin === "project" && item.path === path);
      agents.write(request.projectPath, {
        kind: "agent",
        path,
        origin: "project",
        content: agentFile(request),
        expectedHash: current?.hash ?? null,
        confirm: true,
      });
      return { path };
    },
  };
}
