import { createHash, createPublicKey, type KeyObject, verify } from "node:crypto";
import {
  type ApprovalAnswer,
  ApprovalProof,
  approvalDigests,
  approvalMessage,
  commandDigest,
  commandMessage,
  needsApprovalProof,
  vaultApproveMessage,
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

/** What a refusal says: the text names the allow or the command; the reason code is the same. */
interface Texts {
  required: string;
  expired: string;
}
const ALLOW: Texts = {
  required: "this allow needs the signed proof of an enrolled device",
  expired: "the challenge expired: press Approve again",
};
const COMMAND: Texts = {
  required: "this command needs the confirmation of an enrolled device",
  expired: "the challenge expired: confirm again",
};

/** One refusal for a missing, unknown or bad proof: it never says which, and never echoes a nonce, key or signature. */
const proofRequired = (texts: Texts = ALLOW) =>
  new FlightdeckError("invalid_state", texts.required, "approval_proof_required");

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

  /** Whether a device key is enrolled (a prod or high-risk secret use then takes a proof, #3452). */
  enrolled(): boolean {
    return this.ports.keys().length > 0;
  }

  /**
   * The proof of a prod or high-risk secret use (#3452): a signature of an enrolled key over this request,
   * the scope approved and a live nonce. The caller asks only when a key is enrolled (`enrolled()`).
   */
  checkVault(input: { requestId: string; scope: "once" | "session"; proof?: ApprovalProof }): void {
    const { requestId, scope, proof } = input;
    const key = proof && this.ports.keys().find((candidate) => candidate.keyId === proof.keyId);
    if (!proof || !key) throw proofRequired();
    const message = vaultApproveMessage({
      keyId: key.keyId,
      daemonId: this.ports.daemonId(),
      requestId,
      nonce: proof.nonce,
      scope,
    });
    this.spend(key, proof, message, "approve", requestId);
  }

  /**
   * The proof of a command that moves code or trust (#3453): a signature of an enrolled key over the command
   * and a hash of its whole payload (the proof aside) with a live nonce made for that command. The caller asks
   * only when a key is enrolled and passes its own command name, never a client's field. A payload that
   * omits a field of `mustCarry` is refused as a missing proof: leaving a binding out never skips it.
   */
  checkCommand(
    command: string,
    payload: Record<string, unknown>,
    mustCarry: readonly string[] = [],
  ): void {
    if (mustCarry.some((field) => payload[field] === undefined)) throw proofRequired(COMMAND);
    const proof = ApprovalProof.safeParse(payload.proof);
    const key =
      proof.success && this.ports.keys().find((candidate) => candidate.keyId === proof.data.keyId);
    if (!proof.success || !key) throw proofRequired(COMMAND);
    const message = commandMessage({
      keyId: key.keyId,
      daemonId: this.ports.daemonId(),
      command,
      nonce: proof.data.nonce,
      payloadHash: sha256Hex(commandDigest(payload)),
    });
    this.spend(key, proof.data, message, "command", command, COMMAND);
  }

  check(input: ApprovalCheck): void {
    const { requestId, risk, answer, held, proof } = input;
    if (!needsApprovalProof(risk, answer.updatedPermissions)) return;
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
    this.spend(key, proof, message, "approve", requestId);
  }

  /** A forged proof cannot burn a nonce: it is used up only by a signature of an enrolled key. */
  private spend(
    key: EnrolledKey,
    proof: ApprovalProof,
    message: string,
    purpose: "approve" | "command",
    id: string,
    texts: Texts = ALLOW,
  ): void {
    if (!verifySignature(key.publicKey, message, proof.signature)) throw proofRequired(texts);
    const taken = this.ports.nonces.take(proof.nonce, purpose, id);
    if (taken === "unknown") throw proofRequired(texts);
    if (taken === "expired") {
      throw new FlightdeckError("invalid_state", texts.expired, "approval_challenge_expired");
    }
  }
}
