import { SecretScanner } from "@flightdeck/protocol";

/** What the daemon's log must never let through, read at the moment of each line. */
export interface LogSecretSources {
  /** The tokens the daemon knows: the protocol's (it rotates), the hooks'. */
  tokens(): string[];
  /** The values the vault holds right now. */
  vaultValues(): string[];
}

/** The scanner of the daemon's log (stub). */
export function createLogScanner(_sources: LogSecretSources): SecretScanner {
  return new SecretScanner();
}
