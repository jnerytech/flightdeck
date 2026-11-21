import type { T } from "../../i18n/index.ts";

const SCOPES = ["user", "project", "local"] as const;
type Scope = (typeof SCOPES)[number];

/** A scope this app knows; a newer daemon may send another one. */
export const isScope = (scope: string): scope is Scope =>
  (SCOPES as readonly string[]).includes(scope);

const NAMES = {
  user: "pluginsUi.scope.user",
  project: "pluginsUi.scope.project",
  local: "pluginsUi.scope.local",
} as const;
const HINTS = {
  user: "pluginsUi.scope.userHint",
  project: "pluginsUi.scope.projectHint",
  local: "pluginsUi.scope.localHint",
} as const;

/** What a plugin's scope is called on screen; a scope this app does not know shows as the daemon sent it. */
export function scopeName(t: T, scope: string): string {
  return isScope(scope) ? t(NAMES[scope]) : scope;
}

/** What a plugin's scope means, or nothing for a scope this app does not know. */
export function scopeHint(t: T, scope: string): string | undefined {
  return isScope(scope) ? t(HINTS[scope]) : undefined;
}
