import type { T } from "../../i18n/index.ts";

/** What a plugin's scope is called on screen; a scope this app does not know shows as the daemon sent it. */
export function scopeName(_t: T, scope: string): string {
  return scope;
}

/** What a plugin's scope means, or nothing for a scope this app does not know. */
export function scopeHint(_t: T, _scope: string): string | undefined {
  return undefined;
}
