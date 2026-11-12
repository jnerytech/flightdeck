import { join } from "node:path";
import { AgentConfig, McpConfig } from "../agentcfg/index.ts";
import { decisionLog, ProjectMemory } from "../memory/index.ts";
import { BUILTIN_TEMPLATES, loadTemplates, TaskTracker } from "../templates/index.ts";
import { whichOnPath } from "../which.ts";
import { claudeCli, filePins, Plugins, pluginDecisionLog } from "./plugins.ts";

/** Where the agent setup keeps its files and which `claude` its plugins run (issue #1593). */
export interface AgentSetupOptions {
  executable: () => string | null;
  pinsFile: string;
  pluginDecisionsFile: string;
  memoryDecisionsFile: string;
  tasksDir: string;
  templatesDir: string;
}

/** The agent setup's options as the daemon builds them. */
export function agentSetupOptions({
  dataDir,
  claudePath,
}: {
  dataDir: string;
  claudePath: string | undefined;
}): AgentSetupOptions {
  return {
    executable: () => claudePath ?? whichOnPath("claude"),
    pinsFile: join(dataDir, "plugin-pins.json"),
    pluginDecisionsFile: join(dataDir, "plugin-decisions.jsonl"),
    memoryDecisionsFile: join(dataDir, "memory-decisions.jsonl"),
    tasksDir: join(dataDir, "tasks"),
    templatesDir: join(dataDir, "templates"),
  };
}

/**
 * What a session starts with (the Agent setup context), built here because `plugins` and `memory`
 * sit above `agentcfg` in it: the agent and MCP editors, Claude Code's
 * plugins, the project's auto memory, and the task templates with what their tasks produced.
 */
export function createAgentSetup(deps: { dataDir: string; claudePath: string | undefined }) {
  const options = agentSetupOptions(deps);
  return {
    // Phase 12's agent editor also writes the personas published as project agents.
    agentcfg: new AgentConfig(),
    mcp: new McpConfig(),
    // Phase 26: Claude Code's plugins through its own CLI; pins and decisions sit by the data.
    plugins: new Plugins({
      cli: claudeCli({ executable: options.executable }),
      pins: filePins(options.pinsFile),
      record: pluginDecisionLog(options.pluginDecisionsFile),
    }),
    // Phase 26: the project's auto memory; its writes are recorded by name and hash only.
    memory: new ProjectMemory({ record: decisionLog(options.memoryDecisionsFile) }),
    tasks: new TaskTracker({ dir: options.tasksDir }),
    // The built-in templates and the files of `<dataDir>/templates` (phase 33).
    templates: () => loadTemplates({ dir: options.templatesDir, builtins: BUILTIN_TEMPLATES }),
  };
}
