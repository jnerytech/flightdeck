import { readFile } from "node:fs/promises";
import { settingsEnvOf } from "./domain/settings-env.ts";

/** The env block of Claude Code's settings file; empty when the file is missing or unreadable. */
export async function claudeSettingsEnv(file: string): Promise<Record<string, string>> {
  const text = await readFile(file, "utf8").catch(() => null);
  return text === null ? {} : settingsEnvOf(text);
}
