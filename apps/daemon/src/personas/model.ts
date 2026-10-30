import { createHash } from "node:crypto";
import {
  normalizePersona as normalize,
  type PersonaDef,
  PersonaModelError,
  type SecretScanner,
} from "@flightdeck/protocol";
import { FlightdeckError } from "../errors.ts";

export {
  clampPermissionMode,
  type PersonaDef,
  restrictTools,
  toolAllowed,
} from "@flightdeck/protocol";

const badRequest = (message: string) => new FlightdeckError("bad_request", message);

/** See the shared model; its refusals come out as protocol errors with the same codes. */
export function normalizePersona(raw: unknown, scanner: Pick<SecretScanner, "scan">): PersonaDef {
  try {
    return normalize(raw, scanner);
  } catch (error) {
    if (error instanceof PersonaModelError) throw new FlightdeckError(error.code, error.message);
    throw error;
  }
}

const quoted = (value: string) => JSON.stringify(value);

/** The persona as a markdown file: frontmatter (JSON strings are YAML's quoted ones) and the body. */
export function serializePersona(persona: PersonaDef): string {
  const lines = [
    "---",
    `id: ${persona.id}`,
    `name: ${quoted(persona.name)}`,
    `description: ${quoted(persona.description)}`,
  ];
  if (persona.icon) lines.push(`icon: ${persona.icon}`);
  if (persona.model) lines.push(`model: ${persona.model}`);
  if (persona.effort) lines.push(`effort: ${persona.effort}`);
  if (persona.tools) lines.push(`tools: [${persona.tools.map(quoted).join(", ")}]`);
  if (persona.permissionMode) lines.push(`permissionMode: ${persona.permissionMode}`);
  lines.push("---", persona.body, "");
  return lines.join("\n");
}

/** Reads a persona file. `fileId` is the file name without `.md`: the id must be the same. */
export function parsePersona(source: string, fileId?: string): PersonaDef {
  const file = source.replaceAll("\r\n", "\n");
  const end = file.indexOf("\n---", 3);
  const closes = end >= 0 && (file[end + 4] === "\n" || end + 4 === file.length);
  if (!file.startsWith("---\n") || !closes) {
    throw badRequest("a persona precisa começar com um frontmatter entre linhas ---");
  }
  let header: unknown;
  try {
    header = Bun.YAML.parse(file.slice(4, end));
  } catch (error) {
    throw badRequest(`frontmatter inválido: ${(error as Error).message}`);
  }
  if (typeof header !== "object" || header === null || Array.isArray(header)) {
    throw badRequest("o frontmatter precisa ser um mapa");
  }
  const persona = normalizePersona({ ...header, body: file.slice(end + 4) }, NO_SCAN);
  if (fileId !== undefined && persona.id !== fileId) {
    throw badRequest(`o id (${persona.id}) precisa ser o nome do arquivo (${fileId})`);
  }
  return persona;
}

/** Parsing alone does not scan: saving and resolving do (the scanner is the daemon's). */
const NO_SCAN = { scan: () => [] } as unknown as SecretScanner;

/** The hash a versioned persona is trusted by: the file as it is. */
export function personaHash(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}
