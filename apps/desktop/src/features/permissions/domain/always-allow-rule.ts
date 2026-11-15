import type { PermissionUpdate } from "@flightdeck/protocol";
import { trimTrailingSeparators } from "@/shared/lib/index.ts";

/**
 * The default project rule: the exact command for Bash, the exact file for a tool that names one,
 * the tool's name for the others. A rule for a whole file tool would cover a credential file, and
 * the daemon refuses it (issue #384).
 */
export function defaultRule(
  toolName: string,
  input: Record<string, unknown>,
  cwd?: string,
): string {
  const command = input.command;
  if (toolName === "Bash" && typeof command === "string") return `Bash(${command})`;
  const file = input.file_path ?? input.notebook_path ?? input.path;
  return typeof file === "string" && file !== "" ? `${toolName}(${ruleFile(file, cwd)})` : toolName;
}

/**
 * A file as the CLI reads it in a rule: relative to the folder when it is inside it, `//` and the
 * path when it is absolute outside it (a single leading `/` would mean the project's root).
 */
function ruleFile(path: string, cwd: string | undefined): string {
  const file = path.replaceAll("\\", "/");
  const folder = trimTrailingSeparators((cwd ?? "").replaceAll("\\", "/"));
  if (folder !== "" && file === folder) return ".";
  if (folder !== "" && file.startsWith(`${folder}/`)) return file.slice(folder.length + 1);
  return file.startsWith("/") ? `/${file}` : file;
}

/** The tools whose `path` is the folder they search: their default rule would name a folder. */
const FOLDER_TOOLS = new Set(["Grep", "Glob", "LS"]);

/**
 * Whether the default rule of a request names a folder, which the daemon refuses (it would cover
 * everything below it, credentials included): "Always in this project" is not offered then (#524).
 */
export function namesFolder(toolName: string, input: Record<string, unknown>): boolean {
  return FOLDER_TOOLS.has(toolName) && typeof input.path === "string" && input.path !== "";
}

/** `Bash(npm test:*)` or `Write` as the project rule the daemon validates. */
export function projectRule(text: string): PermissionUpdate {
  const match = /^([^(]+)\((.*)\)$/s.exec(text.trim());
  const rule = match
    ? { toolName: match[1] as string, ruleContent: match[2] as string }
    : { toolName: text.trim() };
  return { type: "addRules", rules: [rule], behavior: "allow", destination: "localSettings" };
}
