import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { PermissionRule } from "@flightdeck/protocol";
import { FlightdeckError } from "../errors.ts";

/** Where Claude Code keeps a project's local (not versioned) settings. */
export const LOCAL_SETTINGS = ".claude/settings.local.json";

type Settings = Record<string, unknown> & { permissions?: Record<string, unknown> };

/** `Bash(mkdir:*)`, or the bare tool name for a rule without content. */
export function ruleString(rule: PermissionRule): string {
  return rule.ruleContent ? `${rule.toolName}(${rule.ruleContent})` : rule.toolName;
}

/** The file as an object; `{}` without it. A file that is not a JSON object is never rewritten. */
async function read(repo: string): Promise<Settings> {
  const file = join(repo, LOCAL_SETTINGS);
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return {};
  }
  let value: unknown = null;
  try {
    value = JSON.parse(text);
  } catch {
    // Falls through to the refusal below.
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FlightdeckError(
      "invalid_state",
      `${LOCAL_SETTINGS} is not a valid JSON object`,
      "settings_invalid",
      { file: LOCAL_SETTINGS },
    );
  }
  return value as Settings;
}

const allowOf = (settings: Settings): string[] => {
  const allow = settings.permissions?.allow;
  return Array.isArray(allow) ? allow.filter((r): r is string => typeof r === "string") : [];
};

async function write(repo: string, settings: Settings, allow: string[]): Promise<void> {
  const file = join(repo, LOCAL_SETTINGS);
  await mkdir(dirname(file), { recursive: true });
  const next = { ...settings, permissions: { ...settings.permissions, allow } };
  await writeFile(file, `${JSON.stringify(next, null, 2)}\n`);
}

/** `permissions.allow` of the repository's settings.local.json; empty without the file. */
export async function readRules(repo: string): Promise<string[]> {
  return allowOf(await read(repo));
}

/** Adds rules to `permissions.allow`, without duplicates and keeping every other key. */
export async function addRules(repo: string, rules: string[]): Promise<void> {
  const settings = await read(repo);
  const allow = allowOf(settings);
  const added = [...new Set(rules)].filter((rule) => !allow.includes(rule));
  if (added.length > 0) await write(repo, settings, [...allow, ...added]);
}

/** Removes one rule from `permissions.allow`, keeping the rest of the file. */
export async function removeRule(repo: string, rule: string): Promise<string[]> {
  const settings = await read(repo);
  const allow = allowOf(settings);
  if (!allow.includes(rule))
    throw new FlightdeckError("not_found", `rule ${rule} does not exist`, "rule_not_found", {
      rule,
    });
  const remaining = allow.filter((r) => r !== rule);
  await write(repo, settings, remaining);
  return remaining;
}
