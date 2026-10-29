/** Stub. */
export type AgentCfgKind = "claudemd" | "agent" | "skill";

export interface AgentCfgItem {
  kind: AgentCfgKind;
  path: string;
  origin: "project" | "user";
  readOnly: boolean;
  hash: string;
  name?: string;
  description?: string;
}

export interface AgentCfgWrite {
  kind: AgentCfgKind;
  path: string;
  content: string;
  expectedHash: string | null;
  confirm: boolean;
  origin?: "project" | "user";
}

/** Stub. */
export class AgentConfig {
  constructor(private readonly opts: { claudeDir?: string } = {}) {}

  list(_project: string, _kind: AgentCfgKind): AgentCfgItem[] {
    return [];
  }

  read(
    _project: string,
    kind: AgentCfgKind,
    path: string,
    origin: "project" | "user" = "project",
  ): AgentCfgItem & { content: string } {
    return { kind, path, origin, readOnly: false, hash: "", content: this.opts.claudeDir ?? "" };
  }

  write(_project: string, _input: AgentCfgWrite): { hash: string } {
    return { hash: "" };
  }
}
