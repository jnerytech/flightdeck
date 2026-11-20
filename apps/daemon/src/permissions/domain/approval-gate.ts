import type { ApprovalAnswer, ApprovalProof } from "@flightdeck/protocol";
import type { NonceBook } from "./nonce-book.ts";
import type { RiskLevel } from "./risk.ts";

/** A device key the person enrolled: its id and its public key (base64 SPKI). */
export interface EnrolledKey {
  keyId: string;
  publicKey: string;
}

export interface ApprovalGatePorts {
  /** The enrolled keys, read on every check: a key enrolled or revoked counts at once. */
  keys: () => readonly EnrolledKey[];
  daemonId: () => string;
  nonces: NonceBook;
}

/** Lowercase hex SHA-256 of a text. */
export function sha256Hex(_text: string): string {
  return "";
}

/** The id of a public key: hex SHA-256 of its SPKI DER. */
export function keyIdOf(_publicKey: string): string {
  return "";
}

/** ECDSA P-256 over SHA-256, the signature in IEEE P1363 form (base64); false for anything malformed. */
export function verifySignature(_publicKey: string, _message: string, _signature: string): boolean {
  return false;
}

/** An allow needs the proof of a device when the request is high risk, or when it saves rules. */
export function needsProof(_risk: RiskLevel, _updates: readonly unknown[]): boolean {
  return false;
}

export interface ApprovalCheck {
  requestId: string;
  risk: RiskLevel;
  answer: ApprovalAnswer;
  /** The Approve was held (`held: true`): the whole guard of a host with no enrolled key. */
  held?: boolean | undefined;
  proof?: ApprovalProof | undefined;
}

/**
 * The guard of an allow (#3439). With no enrolled key it is the hold, as before. With one, an allow that
 * needs a proof must carry a signature of an enrolled key over this request, this answer and a live nonce.
 * One synchronous section: the nonce is used up in the call, and the caller answers right after it.
 */
export class ApprovalGate {
  constructor(private readonly ports: ApprovalGatePorts) {}

  check(_input: ApprovalCheck): void {
    void this.ports;
  }
}
