import { SecretScanner } from "@flightdeck/protocol";

/** What the daemon's log must never let through, read at the moment of each line. */
export interface LogSecretSources {
  /** The tokens the daemon knows: the protocol's (it rotates), the hooks'. */
  tokens(): string[];
  /** The values the vault holds right now. */
  vaultValues(): string[];
}

/**
 * The scanner of the daemon's log: the shapes of secrets, plus the daemon's own tokens (bare
 * random strings no shape tells apart) and whatever the vault holds, asked at each line, so a
 * rotated token or a value delivered a moment ago is covered at once.
 */
export function createLogScanner(sources: LogSecretSources): SecretScanner {
  return new SecretScanner(() => [...sources.tokens(), ...sources.vaultValues()]);
}
