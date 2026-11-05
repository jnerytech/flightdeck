/** What a project's own files would load into a Claude Code session, read without running anything (issue #196). */

export interface ProjectLoad {
  path: string;
  /** Shell commands that run on Claude Code events, by event name. */
  hooks: Array<{ event: string; file: string; commands: string[] }>;
  /** MCP servers the project declares: the name and the command that would start it. */
  mcpServers: Array<{ name: string; file: string; command: string }>;
  /** Names only: a value may be a secret. */
  envKeys: string[];
  allowRules: string[];
  defaultMode: string | null;
  agents: string[];
  skills: string[];
  commands: string[];
  claudeMd: boolean;
  /** Files that exist and could not be read as JSON, or are not what they seem. */
  unreadable: string[];
}

export async function inspectProject(_path: string): Promise<ProjectLoad> {
  return {
    path: "",
    hooks: [],
    mcpServers: [],
    envKeys: [],
    allowRules: [],
    defaultMode: null,
    agents: [],
    skills: [],
    commands: [],
    claudeMd: false,
    unreadable: [],
  };
}
