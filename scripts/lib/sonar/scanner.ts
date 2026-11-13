/**
 * The SonarScanner download of the sonarcloud job, checked here instead of by the scan action
 * (#1883): the action asks a keyserver for SonarSource's key and, when the keyserver does not
 * answer, waits until the job's timeout. The key is committed and its fingerprint pinned.
 */

/** SonarSource's signing key, by its primary key's fingerprint. */
export const SONAR_KEY_FINGERPRINT = "679F1EE92B19609DE816FDE81DB198F93525EC1A";

/** Where the scanner zip and its signature live under the binaries URL. */
export function scannerFiles(
  base: string,
  version: string,
  flavor: string,
): { zip: string; asc: string; name: string } {
  const name = `sonar-scanner-cli-${version}-${flavor}.zip`;
  // No regex: `/\/+$/` backtracks over a long run of slashes (S8786).
  let end = base.length;
  while (end > 0 && base[end - 1] === "/") end--;
  const zip = `${base.slice(0, end)}/${name}`;
  return { zip, asc: `${zip}.asc`, name };
}

/** The primary keys' fingerprints in `gpg --with-colons` output: a subkey's fingerprint is not one. */
export function primaryFingerprints(colons: string): string[] {
  const found: string[] = [];
  let primary = false;
  for (const line of colons.split(/\r?\n/)) {
    const kind = line.slice(0, line.indexOf(":"));
    if (kind === "pub") primary = true;
    else if (kind === "sub" || kind === "sec" || kind === "ssb") primary = false;
    else if (kind === "fpr" && primary) {
      found.push(line.split(":")[9] ?? "");
      primary = false;
    }
  }
  return found;
}

/** True when the output holds exactly one primary key and it is `fingerprint`. */
export function keyMatches(colons: string, fingerprint: string): boolean {
  const primaries = primaryFingerprints(colons);
  return primaries.length === 1 && primaries[0]?.toUpperCase() === fingerprint.toUpperCase();
}

/** Runs `attempt` until it answers true, at most `tries` times; false when none did. */
export async function withRetry(
  attempt: () => boolean | Promise<boolean>,
  tries: number,
): Promise<boolean> {
  for (let i = 0; i < tries; i++) if (await attempt()) return true;
  return false;
}
