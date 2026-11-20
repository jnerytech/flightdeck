import { createHash, createPublicKey, type KeyObject, verify } from "node:crypto";
import {
  type ApprovalAnswer,
  type ApprovalProof,
  approvalDigests,
  approvalMessage,
} from "@flightdeck/protocol";
import { FlightdeckError } from "../../kernel/index.ts";
import { requireHold } from "./hold.ts";
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
export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** The id of a public key: hex SHA-256 of its SPKI DER. */
export function keyIdOf(publicKey: string): string {
  return createHash("sha256").update(Buffer.from(publicKey, "base64")).digest("hex");
}

/** The key behind a base64 SPKI text; undefined unless it is an ECDSA P-256 public key. */
function p256Key(publicKey: string): KeyObject | undefined {
  try {
    const key = createPublicKey({
      key: Buffer.from(publicKey, "base64"),
      format: "der",
      type: "spki",
    });
    const isP256 =
      key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails?.namedCurve === "prime256v1";
    return isP256 ? key : undefined;
  } catch {
    return undefined;
  }
}

/** Whether the text is a device public key this daemon can verify: base64 SPKI of an ECDSA P-256 key. */
export const isDevicePublicKey = (publicKey: string): boolean => p256Key(publicKey) !== undefined;

/** ECDSA P-256 over SHA-256, the signature in IEEE P1363 form (base64); false for anything malformed. */
export function verifySignature(publicKey: string, message: string, signature: string): boolean {
  const key = p256Key(publicKey);
  if (!key) return false;
  try {
    return verify(
      "sha256",
      Buffer.from(message),
      { key, dsaEncoding: "ieee-p1363" },
      Buffer.from(signature, "base64"),
    );
  } catch {
    return false;
  }
}

/** An allow needs the proof of a device when the request is high risk, or when it saves rules. */
export function needsProof(risk: RiskLevel, updates: readonly unknown[]): boolean {
  return risk === "high" || updates.length > 0;
}

/** One refusal for a missing, unknown or bad proof: it never says which, and never echoes a nonce, key or signature. */
const proofRequired = () =>
  new FlightdeckError(
    "invalid_state",
    "this allow needs the signed proof of an enrolled device",
    "approval_proof_required",
  );

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

  check(input: ApprovalCheck): void {
    const { requestId, risk, answer, held, proof } = input;
    if (!needsProof(risk, answer.updatedPermissions ?? [])) return;
    const keys = this.ports.keys();
    if (keys.length === 0) {
      requireHold(risk, held);
      return;
    }
    const key = proof && keys.find((candidate) => candidate.keyId === proof.keyId);
    if (!proof || !key) throw proofRequired();
    const digests = approvalDigests(answer);
    const message = approvalMessage({
      keyId: key.keyId,
      daemonId: this.ports.daemonId(),
      requestId,
      nonce: proof.nonce,
      permissionsHash: sha256Hex(digests.permissions),
      inputHash: sha256Hex(digests.input),
      messageHash: sha256Hex(digests.message),
    });
    // A forged proof cannot burn a nonce: it is used up only by a signature of an enrolled key.
    if (!verifySignature(key.publicKey, message, proof.signature)) throw proofRequired();
    const taken = this.ports.nonces.take(proof.nonce, "approve", requestId);
    if (taken === "unknown") throw proofRequired();
    if (taken === "expired") {
      throw new FlightdeckError(
        "invalid_state",
        "the challenge expired: press Approve again",
        "approval_challenge_expired",
      );
    }
  }
}
