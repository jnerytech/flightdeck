import { parseJsonText } from "../../kernel/index.ts";

/**
 * The env block of Claude Code's settings file (`~/.claude/settings.json`), as strings; empty when
 * the text is broken or has no env block. Issue #486: `/scroll-speed` keeps the person's
 * value there, and the daemon's default for terminals must not shadow it.
 */
export function settingsEnvOf(text: string): Record<string, string> {
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
