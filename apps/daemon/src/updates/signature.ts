/**
 * Minisign signatures as `tauri signer` writes them: Ed25519 over the file ("Ed") or over its
 * BLAKE2b-512 ("ED"), plus a global signature over the signature and its trusted comment. The
 * key and the signature come as the minisign text, usually wrapped in base64.
 */
import { createHash, createPublicKey, type KeyObject, verify } from "node:crypto";

const ED25519_SPKI = Buffer.from("302a300506032b6570032100", "hex");

export class SignatureError extends Error {}

/** The minisign text: as given, or decoded when it comes wrapped in base64. */
function unwrap(text: string): string[] {
  const trimmed = text.trim();
  const plain = trimmed.startsWith("untrusted comment:")
    ? trimmed
    : Buffer.from(trimmed, "base64").toString("utf8");
  return plain.split(/\r?\n/);
}

/** The key id and Ed25519 key of a minisign public key; throws on anything else. */
export function parsePublicKey(text: string): { keyId: Buffer; key: KeyObject } {
  const lines = unwrap(text);
  const raw = Buffer.from(lines[1] ?? "", "base64");
  if (
    !lines[0]?.startsWith("untrusted comment:") ||
    raw.length !== 42 ||
    raw.toString("latin1", 0, 2) !== "Ed"
  ) {
    throw new SignatureError("formato de chave pública inválido");
  }
  const key = createPublicKey({
    key: Buffer.concat([ED25519_SPKI, raw.subarray(10)]),
    format: "der",
    type: "spki",
  });
  return { keyId: raw.subarray(2, 10), key };
}

function parseSignature(text: string) {
  const lines = unwrap(text);
  const sig = Buffer.from(lines[1] ?? "", "base64");
  const algorithm = sig.toString("latin1", 0, 2);
  const trusted = lines[2] ?? "";
  if (
    !lines[0]?.startsWith("untrusted comment:") ||
    sig.length !== 74 ||
    (algorithm !== "Ed" && algorithm !== "ED") ||
    !trusted.startsWith("trusted comment: ")
  ) {
    throw new SignatureError("formato de assinatura inválido");
  }
  return {
    prehashed: algorithm === "ED",
    keyId: sig.subarray(2, 10),
    signature: sig.subarray(10),
    trusted: trusted.slice("trusted comment: ".length),
    global: Buffer.from(lines[3] ?? "", "base64"),
  };
}

/** Throws a `SignatureError` saying why `data` is not signed by `publicKey`. */
export function verifyMinisign(data: Uint8Array, signature: string, publicKey: string): void {
  const { keyId, key } = parsePublicKey(publicKey);
  const sig = parseSignature(signature);
  if (!sig.keyId.equals(keyId)) {
    throw new SignatureError("a assinatura é de outra chave, não da chave do Flightdeck");
  }
  const signed = sig.prehashed ? createHash("blake2b512").update(data).digest() : data;
  if (!verify(null, signed, key, sig.signature)) {
    throw new SignatureError("a assinatura não confere com o arquivo");
  }
  const comment = Buffer.concat([sig.signature, Buffer.from(sig.trusted)]);
  if (!verify(null, comment, key, sig.global)) {
    throw new SignatureError("o comentário confiável da assinatura foi alterado");
  }
}
