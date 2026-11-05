/**
 * Phase 39: OpenCode's tool names and inputs, as Flightdeck's risk rules, plain texts, persona tool
 * lists and tool cards know them (Claude's). A tool whose input does not map field by field keeps
 * its own name as `opencode:<name>`, which the risk rules rate high.
 */

export interface MappedTool {
  name: string;
  input: Record<string, unknown>;
}

/** OpenCode tool to Claude tool, with the input fields that change name (the rest keep theirs). */
const TOOLS: Record<string, { name: string; fields?: Record<string, string> }> = {
  shell: { name: "Bash" },
  read: { name: "Read", fields: { path: "file_path" } },
  write: { name: "Write", fields: { path: "file_path" } },
  edit: {
    name: "Edit",
    fields: {
      path: "file_path",
      oldString: "old_string",
      newString: "new_string",
      replaceAll: "replace_all",
    },
  },
  glob: { name: "Glob" },
  grep: { name: "Grep" },
  webfetch: { name: "WebFetch" },
  websearch: { name: "WebSearch" },
};

/** OpenCode names an MCP tool `<server>_<tool>`; ours is the server `flightdeck`. */
const FLIGHTDECK_MCP = "flightdeck_";

export function mapOpenCodeTool(name: string, input: Record<string, unknown>): MappedTool {
  const known = TOOLS[name];
  if (known) {
    const fields = known.fields ?? {};
    return {
      name: known.name,
      input: Object.fromEntries(
        Object.entries(input).map(([key, value]) => [fields[key] ?? key, value]),
      ),
    };
  }
  if (name.startsWith(FLIGHTDECK_MCP)) {
    return { name: `mcp__flightdeck__${name.slice(FLIGHTDECK_MCP.length)}`, input };
  }
  return { name: `opencode:${name}`, input };
}
