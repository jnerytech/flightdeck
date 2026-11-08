import { readFile } from "node:fs/promises";
import { parseJsonText } from "../json-text.ts";

/**
 * The env block of Claude Code's settings file (`~/.claude/settings.json`), as strings; empty when
 * the file is missing, broken or has no env block. Issue #486: `/scroll-speed` keeps the person's
 * value there, and the daemon's default for terminals must not shadow it.
 */
export async function claudeSettingsEnv(file: string): Promise<Record<string, string>> {
  const text = await readFile(file, "utf8").catch(() => null);
  if (text === null) return {};
  let settings: unknown;
  try {
    settings = parseJsonText(text);
  } catch {
    return {};
  }
  const env = (settings as { env?: unknown } | null)?.env;
  if (!env || typeof env !== "object" || Array.isArray(env)) return {};
  return Object.fromEntries(Object.entries(env).map(([key, value]) => [key, String(value)]));
}
