/**
 * Phase 39: nothing in the test environment may point an OpenCode process at a real config, data
 * or state folder, or carry an OpenCode switch: the `OPENCODE_*` variables and the XDG folders go.
 */
export function scrubOpenCodeEnv(env: Record<string, string | undefined>): void {
  for (const key of Object.keys(env)) {
    if (/^OPENCODE_/i.test(key) || /^XDG_(CONFIG|DATA|STATE|CACHE)_HOME$/i.test(key))
      delete env[key];
  }
}
