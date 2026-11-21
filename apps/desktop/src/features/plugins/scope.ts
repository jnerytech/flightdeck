import type { T } from "../../i18n/index.ts";

const SCOPES = ["user", "project", "local"] as const;
type Scope = (typeof SCOPES)[number];

const known = (scope: string): scope is Scope => (SCOPES as readonly string[]).includes(scope);

/** What a plugin's scope is called on screen; a scope this app does not know shows as the daemon sent it. */
export function scopeName(t: T, scope: string): string {
  return known(scope) ? t(`pluginsUi.scope.${scope}`) : scope;
}

/** What a plugin's scope means, or nothing for a scope this app does not know. */
export function scopeHint(t: T, scope: string): string | undefined {
  return known(scope) ? t(`pluginsUi.scope.${scope}Hint`) : undefined;
}
