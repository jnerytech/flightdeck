/** Variables that would make the child bill an API key instead of the host's subscription. */
export const API_KEY_VARS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"] as const;

/**
 * Builds the environment handed to the agent runtime. Drops API-key variables unless
 * `allowApiKey` is set; everything else (including `CLAUDE_CODE_OAUTH_TOKEN`) is kept.
 */
export function buildChildEnv(
  base: Record<string, string | undefined>,
  allowApiKey: boolean,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) continue;
    if (!allowApiKey && (API_KEY_VARS as readonly string[]).includes(key.toUpperCase())) continue;
    env[key] = value;
  }
  return env;
}
