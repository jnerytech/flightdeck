import { PermissionUpdate } from "@flightdeck/protocol";
import { FlightdeckError } from "../errors.ts";
import { RANK, type RiskLevel } from "./risk.ts";
import {
  type ClassifyCall,
  type DiskView,
  exactPaths,
  pathReadings,
  ruleLevel,
} from "./rule-risk.ts";

/** Destinations an answer may write to: the session, or the project's settings.local.json. */
const DESTINATIONS: ReadonlySet<string> = new Set(["session", "localSettings"]);
/** Modes no answer may switch to. */
const FORBIDDEN_MODES: ReadonlySet<string> = new Set(["bypassPermissions", "auto"]);
const MAX_RULE_CONTENT = 500;

/** The suggestions of a request that make sense; anything this daemon does not know is dropped. */
export function parseSuggestions(raw: unknown): PermissionUpdate[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const parsed = PermissionUpdate.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

/** The same JSON with object keys sorted: equality field by field, whatever the key order. */
export const canonical = (value: unknown) =>
  JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );

const refuse = (
  message: string,
  reason: string,
  params?: Record<string, string | number>,
): never => {
  throw new FlightdeckError("invalid_permission_update", message, reason, params);
};

/** A project rule: `addRules` with `allow` to `localSettings` (shape only; tools checked apart). */
export function isProjectRule(
  update: PermissionUpdate,
): update is Extract<PermissionUpdate, { type: "addRules" }> {
  return (
    update.type === "addRules" &&
    update.behavior === "allow" &&
    update.destination === "localSettings" &&
    update.rules.length > 0
  );
}

type AddRules = Extract<PermissionUpdate, { type: "addRules" }>;

/** A rule must be for the request's own tool, with a one-line content of bounded size. */
/** Tools that always ask: no "always allow" is offered for them and no rule may be saved. */
export const alwaysAsks = (toolName: string): boolean => toolName.endsWith("__finish_card");

function checkRule(rule: AddRules["rules"][number], toolName: string): void {
  if (rule.toolName !== toolName)
    refuse(`a regra é de outra ferramenta (${rule.toolName})`, "perm_rule_other_tool", {
      tool: rule.toolName,
    });
  const content = rule.ruleContent;
  if (
    content !== undefined &&
    (!content || /[\r\n]/.test(content) || content.length > MAX_RULE_CONTENT)
  ) {
    refuse("conteúdo da regra inválido", "perm_rule_content_invalid");
  }
}

/**
 * A saved rule covers every call it matches, not only the one it came from: it must not cover a
 * higher risk than the request did (issue #384). A rule for `Bash` alone, or `git:*`, covers
 * `rm -rf` and `git push --force`; a rule for `Write` alone covers a credential file.
 */
function checkRisk(
  rule: AddRules["rules"][number],
  request: { risk: RiskLevel; classify: ClassifyCall } & DiskView,
): void {
  const level = ruleLevel(
    rule.toolName,
    rule.ruleContent,
    request.classify,
    request.kind ?? (() => "dir"),
    request.real,
  );
  // `any`: not shown to be narrow, so no request, held or not, may save it.
  if (level === "any" || RANK[level] > RANK[request.risk])
    refuse("a regra permitiria mais risco do que este pedido", "perm_rule_too_broad", {
      tool: rule.toolName,
      level: level === "any" ? "high" : level,
    });
}

/** The destination and the mode of an update must be ones an answer may use. */
function checkDestinationAndMode(update: PermissionUpdate): void {
  if (!DESTINATIONS.has(update.destination))
    refuse(`destino ${update.destination} não é permitido`, "perm_destination_denied", {
      destination: update.destination,
    });
  if (update.type === "setMode" && FORBIDDEN_MODES.has(update.mode)) {
    refuse(`modo ${update.mode} não é permitido`, "perm_mode_denied", { mode: update.mode });
  }
}

/**
 * Refuses (`invalid_permission_update`) any update that is neither one of the request's own
 * suggestions (destination `session` or `localSettings`, never `bypassPermissions` or `auto`)
 * nor a project rule for its tool, with a one-line rule content of up to 500 characters.
 */
export function checkUpdates(
  updates: PermissionUpdate[],
  request: {
    toolName: string;
    suggestions: PermissionUpdate[];
    /** The risk judged when it was asked, and the daemon's classifier for what a rule would cover. */
    risk: RiskLevel;
    classify: ClassifyCall;
  } & DiskView,
): void {
  const suggested = new Set(request.suggestions.map(canonical));
  for (const update of updates) {
    checkDestinationAndMode(update);
    if (update.type === "addRules" && update.rules.some((rule) => alwaysAsks(rule.toolName))) {
      refuse("esta ferramenta sempre pergunta: nenhuma regra a libera", "perm_tool_always_asks");
    }
    if (suggested.has(canonical(update))) continue;
    if (!isProjectRule(update))
      refuse("não é uma das sugestões do pedido nem uma regra do projeto", "perm_not_suggested");
    for (const rule of (update as AddRules).rules) {
      checkRule(rule, request.toolName);
      checkRisk(rule, request);
    }
  }
}

/** What `of` gives for each rule `updates` would add. */
const eachRule = (
  updates: PermissionUpdate[],
  of: (toolName: string, content: string | undefined) => string[],
) =>
  updates.flatMap((update) =>
    update.type === "addRules"
      ? update.rules.flatMap((rule) => of(rule.toolName, rule.ruleContent))
      : [],
  );

/** The exact paths the rules of `updates` name, for the server to look up before the check. */
export function rulePaths(updates: PermissionUpdate[]): string[] {
  return eachRule(updates, exactPaths);
}

/** Every reading of the path rules of `updates`, for the server to resolve before the check (#528). */
export function ruleReadings(updates: PermissionUpdate[]): string[] {
  return eachRule(updates, pathReadings);
}
