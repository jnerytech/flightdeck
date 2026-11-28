import type { SshAuth, SshTarget } from "@flightdeck/protocol";

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

/** Whether a saved destino sets anything the form keeps under its advanced options. */
export const hasAdvanced = (target: SshTarget | null): boolean =>
  target !== null &&
  (target.viaHost !== null ||
    target.jump !== null ||
    (target.options.serverAliveInterval ?? 0) > 0 ||
    target.options.compression === true ||
    (target.options.localForward ?? []).length > 0 ||
    target.options.forwardAgent === true);

const WHOLE = /^\d+$/;

/** A port is a whole number from 1 to 65535. */
export const validPort = (text: string): boolean => {
  const value = text.trim();
  return WHOLE.test(value) && Number(value) >= 1 && Number(value) <= 65535;
};

/** A keep-alive is empty (no option) or a whole number of 0 or more. */
export const validAlive = (text: string): boolean => {
  const value = text.trim();
  return value === "" || (WHOLE.test(value) && Number.isSafeInteger(Number(value)));
};

/** What a person typed in the form, as the form holds it. */
export interface TargetDraft {
  name: string;
  host: string;
  port: string;
  user: string;
  auth: SshAuth;
  keyFile: string;
  secretId: string;
  via: string;
  jump: string;
  tags: string;
  alive: string;
  compression: boolean;
  forwards: string;
  forwardAgent: boolean;
}

/** Whether the form differs from the saved destino, the way a save would write it (#4330). */
export function unsaved(target: SshTarget, draft: TargetDraft): boolean {
  const alive = Number(draft.alive);
  const options = target.options;
  return (
    draft.name.trim() !== target.name ||
    draft.host.trim() !== target.host ||
    Number(draft.port) !== target.port ||
    draft.user.trim() !== target.user ||
    draft.auth !== target.auth ||
    secretRefOf(draft.auth, draft.keyFile, draft.secretId) !== (target.secretRef ?? null) ||
    (draft.via || null) !== (target.viaHost ?? null) ||
    (draft.jump || null) !== (target.jump ?? null) ||
    split(draft.tags, ",").join(",") !== target.tags.join(",") ||
    Math.max(alive || 0, 0) !== (options.serverAliveInterval ?? 0) ||
    draft.compression !== (options.compression ?? false) ||
    split(draft.forwards, "\n").join("\n") !== (options.localForward ?? []).join("\n") ||
    draft.forwardAgent !== (options.forwardAgent ?? false)
  );
}

/** The required fields the form still lacks, in the order the form shows them. */
export type MissingField = "name" | "host" | "user" | "vaultKey";

export function missingFields(
  draft: Pick<TargetDraft, "name" | "host" | "user" | "auth" | "secretId">,
): MissingField[] {
  const missing: MissingField[] = [];
  if (draft.name.trim() === "") missing.push("name");
  if (draft.host.trim() === "") missing.push("host");
  if (draft.user.trim() === "") missing.push("user");
  if (draft.auth === "vault-key" && draft.secretId === "") missing.push("vaultKey");
  return missing;
}

/** The most local forwards the daemon keeps for one destino. */
export const MAX_FORWARDS = 20;

// The daemon's rule (apps/daemon/src/ssh/targets.ts): [bind:]port:host:port, ports from 1 to 65535.
const FORWARD = /^(?:[A-Za-z0-9.*-]+:)?(\d{1,5}):[A-Za-z0-9][A-Za-z0-9._-]*:(\d{1,5})$/;

/** What is wrong with the local forwards, the way the daemon would refuse them; `null` when they are fine. */
export function forwardsProblem(
  forwards: string,
): { kind: "line"; line: string } | { kind: "many" } | null {
  const lines = split(forwards, "\n");
  if (lines.length > MAX_FORWARDS) return { kind: "many" };
  for (const line of lines) {
    const match = FORWARD.exec(line);
    if (!match || !validPort(match[1] ?? "") || !validPort(match[2] ?? "")) {
      return { kind: "line", line: line.slice(0, 40) };
    }
  }
  return null;
}
