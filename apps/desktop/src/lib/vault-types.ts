import type { SecretType } from "./vault.ts";

/** What the screen may show about a secret without revealing it. */
export interface SecretInfo {
  publicKey?: string;
  fingerprint?: string;
  /** A token's recognizable shape, for example `ghp_…abcd`. */
  hint?: string;
  /** The names of an env set, in order. */
  names?: string[];
}

const MAGIC = "openssh-key-v1\0";
const MIN_TOKEN_LENGTH = 16;

/** Reads the length-prefixed fields of an OpenSSH blob; null when it ends early. */
function readString(bytes: Uint8Array, offset: number): [Uint8Array, number] | null {
  if (offset + 4 > bytes.length) return null;
  const length = new DataView(bytes.buffer, bytes.byteOffset).getUint32(offset);
  const end = offset + 4 + length;
  return end > bytes.length ? null : [bytes.subarray(offset + 4, end), end];
}

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

/** The public key is stored in the clear in the OpenSSH private key, even with a passphrase. */
async function sshInfo(value: string): Promise<SecretInfo> {
  const body = value.match(/-----BEGIN OPENSSH PRIVATE KEY-----([\s\S]*?)-----END/)?.[1];
  if (!body) return {};
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(body.replace(/\s+/g, "")), (c) => c.charCodeAt(0));
  } catch {
    return {};
  }
  if (text(bytes.subarray(0, MAGIC.length)) !== MAGIC) return {};
  let offset = MAGIC.length;
  for (let i = 0; i < 3; i++) {
    const field = readString(bytes, offset);
    if (!field) return {};
    offset = field[1];
  }
  offset += 4; // number of keys
  const blob = readString(bytes, offset)?.[0];
  const kind = blob && readString(blob, 0)?.[0];
  if (!blob || !kind) return {};
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", blob.slice()));
  return {
    publicKey: `${text(kind)} ${toBase64(blob)}`,
    fingerprint: `SHA256:${toBase64(digest).replace(/=+$/, "")}`,
  };
}

function tokenInfo(value: string): SecretInfo {
  if (value.length < MIN_TOKEN_LENGTH) return {};
  const prefix = value.match(/^[A-Za-z0-9]{2,5}[_-]/)?.[0] ?? value.slice(0, 3);
  return { hint: `${prefix}…${value.slice(-4)}` };
}

function envInfo(value: string): SecretInfo {
  const names = value
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1])
    .filter((name): name is string => name !== undefined);
  return { names };
}

export async function describeSecret(type: SecretType, value: string): Promise<SecretInfo> {
  if (type === "ssh-key") return sshInfo(value);
  if (type === "token") return tokenInfo(value);
  if (type === "env") return envInfo(value);
  return {};
}
