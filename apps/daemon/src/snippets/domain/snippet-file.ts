/**
 * The snippets of a project's versioned `.flightdeck/snippets.yaml`: the id a file snippet gets
 * (it has no row of its own) and the block YAML written back. Pure text over the model's defs; the
 * file itself is read and written by the store.
 */
import type { SnippetVar } from "@flightdeck/protocol";
import type { SnippetDef } from "./model.ts";

const FILE_PREFIX = "file:";

/** The id of a snippet of the versioned file: it has no row of its own. */
export const fileId = (projectPath: string, name: string) => `${FILE_PREFIX}${projectPath}:${name}`;

export function parseFileId(id: string): { projectPath: string; name: string } | null {
  if (!id.startsWith(FILE_PREFIX)) return null;
  const rest = id.slice(FILE_PREFIX.length);
  const at = rest.lastIndexOf(":");
  return at < 1 ? null : { projectPath: rest.slice(0, at), name: rest.slice(at + 1) };
}

const quoted = (text: string) => JSON.stringify(text);

/** Block YAML for the file, with JSON strings (which are YAML's double-quoted ones). */
export function toYaml(defs: SnippetDef[]): string {
  if (defs.length === 0) return "[]\n";
  const lines: string[] = [];
  for (const def of defs) {
    lines.push(
      `- name: ${quoted(def.name)}`,
      `  type: ${def.type}`,
      def.type === "command"
        ? `  run: ${quoted(def.run as string)}`
        : `  text: ${quoted(def.text as string)}`,
    );
    const vars = Object.entries(def.vars);
    if (vars.length > 0) {
      lines.push("  vars:");
      for (const [key, spec] of vars) lines.push(`    ${key}: ${flowVar(spec)}`);
    }
    if (def.tags.length > 0) lines.push(`  tags: [${def.tags.map(quoted).join(", ")}]`);
  }
  return `${lines.join("\n")}\n`;
}

function flowVar(spec: SnippetVar): string {
  const parts: string[] = [];
  if (spec.default !== undefined) parts.push(`default: ${quoted(spec.default)}`);
  if (spec.options && spec.options.length > 0) {
    parts.push(`options: [${spec.options.map(quoted).join(", ")}]`);
  }
  return parts.length === 0 ? "{}" : `{ ${parts.join(", ")} }`;
}
