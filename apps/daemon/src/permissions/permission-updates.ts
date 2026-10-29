import { PermissionUpdate } from "@flightdeck/protocol";
import { FlightdeckError } from "../errors.ts";

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
const canonical = (value: unknown) =>
  JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );

const refuse = (reason: string): never => {
  throw new FlightdeckError("invalid_permission_update", reason);
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

/**
 * Refuses (`invalid_permission_update`) any update that is neither one of the request's own
 * suggestions (destination `session` or `localSettings`, never `bypassPermissions` or `auto`)
 * nor a project rule for its tool, with a one-line rule content of up to 500 characters.
 */
export function checkUpdates(
  updates: PermissionUpdate[],
  request: { toolName: string; suggestions: PermissionUpdate[] },
): void {
  const suggested = new Set(request.suggestions.map(canonical));
  for (const update of updates) {
    if (!DESTINATIONS.has(update.destination))
      refuse(`destino ${update.destination} não é permitido`);
    if (update.type === "setMode" && FORBIDDEN_MODES.has(update.mode)) {
      refuse(`modo ${update.mode} não é permitido`);
    }
    if (suggested.has(canonical(update))) continue;
    if (!isProjectRule(update))
      refuse("não é uma das sugestões do pedido nem uma regra do projeto");
    for (const rule of (update as Extract<PermissionUpdate, { type: "addRules" }>).rules) {
      if (rule.toolName !== request.toolName)
        refuse(`a regra é de outra ferramenta (${rule.toolName})`);
      const content = rule.ruleContent;
      if (
        content !== undefined &&
        (!content || /[\r\n]/.test(content) || content.length > MAX_RULE_CONTENT)
      ) {
        refuse("conteúdo da regra inválido");
      }
    }
  }
}
