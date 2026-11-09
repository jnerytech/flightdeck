/**
 * Issue #1477: `bun run sonar-left` lists SonarCloud's open findings on main and marks the ones
 * whose file changed on main since Sonar's last analysed commit (`STALE?`): Sonar analyses main
 * only on full runs, so its list goes stale between them. The API is public: no token.
 */

/** The answer of a GET, as much as the script reads of it. */
export interface Fetched {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export interface SonarLeftDeps {
  fetch(url: string): Promise<Fetched>;
  /** Runs git in the repository; never throws. */
  git(args: string[]): Promise<{ code: number; stdout: string }>;
  log(line: string): void;
}

/** `sonar-left [--severity CRITICAL,MAJOR] [--path <prefix>]`; the exit code. */
export async function sonarLeft(_args: string[], _deps: SonarLeftDeps): Promise<number> {
  return 0;
}
