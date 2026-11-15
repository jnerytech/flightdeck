/**
 * The snippets of a project's versioned `.flightdeck/snippets.yaml`: the id a file snippet gets
 * (it has no row of its own) and the block YAML written back. Pure text over the model's defs; the
 * file itself is read and written by the snippet-yaml-file adapter.
 */
import { SnippetInput, type SnippetVar } from "@flightdeck/protocol";
import { FlightdeckError } from "../../kernel/index.ts";
import { normalizeSnippet, type SecretScanner, type SnippetDef } from "./model.ts";

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

/**
 * A YAML (or JSON, which YAML reads too) list of snippets: the valid ones, normalized and with
 * unique names, and why each of the others was left out. Shared by the versioned file and an
 * import from a file.
 */
export function parseSnippetList(
  text: string,
  scanner: SecretScanner,
): { defs: SnippetDef[]; errors: string[] } {
  const errors: string[] = [];
  const defs: SnippetDef[] = [];
  let data: unknown;
  try {
    data = Bun.YAML.parse(text) ?? [];
  } catch (error) {
    errors.push(`YAML inválido: ${(error as Error).message}`);
    data = [];
  }
  if (!Array.isArray(data)) {
    errors.push("o arquivo precisa ser uma lista de snippets");
    data = [];
  }
  for (const [index, item] of (data as unknown[]).entries()) {
    const parsed = SnippetInput.safeParse(item);
    const label = parsed.success ? parsed.data.name : `entrada ${index + 1}`;
    if (!parsed.success) {
      errors.push(`${label}: ${(parsed.error.issues[0] as { message: string }).message}`);
      continue;
    }
    try {
      const def = normalizeSnippet(parsed.data, scanner);
      if (defs.some((d) => d.name === def.name))
        throw new FlightdeckError("bad_request", "repeated name", "name_taken", {
          name: def.name,
        });
      defs.push(def);
    } catch (error) {
      errors.push(`${label}: ${(error as Error).message}`);
    }
  }
  return { defs, errors };
}
