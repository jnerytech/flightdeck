import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
function read(repo: string): Settings {
  const file = join(repo, LOCAL_SETTINGS);
  if (!existsSync(file)) return {};
  let value: unknown = null;
  try {
    value = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    // Falls through to the refusal below.
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FlightdeckError("invalid_state", `${LOCAL_SETTINGS} não é um objeto JSON válido`);
  }
  return value as Settings;
}

const allowOf = (settings: Settings): string[] => {
  const allow = settings.permissions?.allow;
  return Array.isArray(allow) ? allow.filter((r): r is string => typeof r === "string") : [];
};

function write(repo: string, settings: Settings, allow: string[]): void {
  const file = join(repo, LOCAL_SETTINGS);
  mkdirSync(dirname(file), { recursive: true });
  const next = { ...settings, permissions: { ...settings.permissions, allow } };
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
}

/** `permissions.allow` of the repository's settings.local.json; empty without the file. */
export function readRules(repo: string): string[] {
  return allowOf(read(repo));
}

/** Adds rules to `permissions.allow`, without duplicates and keeping every other key. */
export function addRules(repo: string, rules: string[]): void {
  const settings = read(repo);
  const allow = allowOf(settings);
  const added = [...new Set(rules)].filter((rule) => !allow.includes(rule));
  if (added.length > 0) write(repo, settings, [...allow, ...added]);
}

/** Removes one rule from `permissions.allow`, keeping the rest of the file. */
export function removeRule(repo: string, rule: string): string[] {
  const settings = read(repo);
  const allow = allowOf(settings);
  if (!allow.includes(rule)) throw new FlightdeckError("not_found", `regra ${rule} não existe`);
  const remaining = allow.filter((r) => r !== rule);
  write(repo, settings, remaining);
  return remaining;
}
