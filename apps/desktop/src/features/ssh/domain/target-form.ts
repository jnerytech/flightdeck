import type { SshAuth } from "@flightdeck/protocol";

export const AUTHS: SshAuth[] = ["agent", "key-file", "vault-key", "password"];
/** The dictionary key of each authentication the form offers. */
export const AUTH_KEY = {
  agent: "agent",
  "key-file": "keyFile",
  "vault-key": "vaultKey",
  password: "password",
} as const;

export const split = (text: string, separator: string): string[] =>
  text
    .split(separator)
    .map((part) => part.trim())
    .filter(Boolean);

/** The secret a target uses: the key file's path, the vault secret, or none for the agent. */
export function secretRefOf(auth: string, keyFile: string, secretId: string): string | null {
  if (auth === "key-file") return keyFile.trim() || null;
  return auth === "vault-key" || auth === "password" ? secretId || null : null;
}
