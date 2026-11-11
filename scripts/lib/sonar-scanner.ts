/**
 * The SonarScanner download of the sonarcloud job, checked here instead of by the scan action
 * (#1883): the action asks a keyserver for SonarSource's key and, when the keyserver does not
 * answer, waits until the job's timeout. The key is committed and its fingerprint pinned.
 */

/** SonarSource's signing key, by its primary key's fingerprint. */
export const SONAR_KEY_FINGERPRINT = "";

/** Where the scanner zip and its signature live under the binaries URL. */
export function scannerFiles(
  base: string,
  version: string,
  flavor: string,
): { zip: string; asc: string; name: string } {
  return { zip: "", asc: "", name: "" };
}

/** The primary keys' fingerprints in `gpg --with-colons` output: a subkey's fingerprint is not one. */
export function primaryFingerprints(colons: string): string[] {
  return [];
}

/** True when the output holds exactly one primary key and it is `fingerprint`. */
export function keyMatches(colons: string, fingerprint: string): boolean {
  return false;
}

/** Runs `attempt` until it answers true, at most `tries` times; false when none did. */
export async function withRetry(attempt: () => Promise<boolean>, tries: number): Promise<boolean> {
  return false;
}
