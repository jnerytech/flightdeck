/** The devices that approve for the person (#3439): challenges, enrollment, revoke and the list. */
import type { Database } from "bun:sqlite";
import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  type ApprovalEnrolled,
  type ApprovalKeyInfo,
  type ApprovalRevoked,
  type CommandPayload,
  enrollAddMessage,
  enrollFirstMessage,
  revokeMessage,
} from "@flightdeck/protocol";
import { FlightdeckError } from "../kernel/index.ts";
import { ApprovalStore } from "./approval-store.ts";
import {
  ApprovalGate,
  type EnrolledKey,
  isDevicePublicKey,
  keyIdOf,
  sha256Hex,
  verifySignature,
} from "./domain/approval-gate.ts";
import { NONCE_TTL_MS, NonceBook, type NoncePurpose } from "./domain/nonce-book.ts";

interface ApproversOptions {
  now: () => Date;
  /** A monotonic clock in ms (a nonce's life). */
  mono: () => number;
  /** Unguessable text, for nonces and the daemon id. */
  random: () => string;
}

/** Who asks: the connection (a nonce is held per connection), the address it came from and the name it said hello with. */
export interface Asker {
  connection: number;
  address: string;
  client: string;
}

/** What a watcher hears: a device was enrolled or revoked. */
export type ApprovalChange =
  | (Omit<ApprovalEnrolled, "type"> & { type: "approval.enrolled" })
  | ApprovalRevoked;

/** How long the window of the first device stays open. */
const ENROLL_WINDOW_MS = 10 * 60_000;

/** Wrong codes one window takes before it closes. */
const MAX_WRONG_CODES = 5;

const refuse = (reason: string, message: string) =>
  new FlightdeckError("invalid_state", message, reason);
/** One refusal for a missing, unknown or bad proof, signature or code: it never says which. */
const proofRequired = () =>
  refuse("approval_proof_required", "the signed proof of an enrolled device is needed");

/**
 * The enrolled devices. A key is added in two ways: the first with the one-time code the host terminal
 * printed, inside a window only that terminal opens (`ApprovalStore.openWindow`); every other by a key
 * already enrolled. No protocol command opens the window or resets: the terminal does, on the store.
 */
export class Approvers {
  readonly store: ApprovalStore;
  readonly nonces: NonceBook;
  /** The guard of an allow: built on this service's keys, daemon id and nonces. */
  readonly gate: ApprovalGate;
  private id: string | undefined;

  private readonly opts: ApproversOptions;

  /** The real clock and randomness unless a test (or the CLI's `--now`) injects its own. */
  constructor(db: Database, opts: Partial<ApproversOptions> = {}) {
    this.opts = {
      now: () => new Date(),
      mono: () => performance.now(),
      random: () => randomBytes(24).toString("base64url"),
      ...opts,
    };
    this.store = new ApprovalStore(db, this.opts.random);
    this.nonces = new NonceBook({ mono: this.opts.mono, random: this.opts.random });
    this.gate = new ApprovalGate({
      keys: () => this.keys(),
      daemonId: () => this.daemonId(),
      nonces: this.nonces,
    });
  }

  /** Calls `listener` for each device enrolled or revoked from now on; the returned function stops it. */
  onChange(_listener: (change: ApprovalChange) => void): () => void {
    return () => undefined;
  }

  daemonId(): string {
    this.id ??= this.store.daemonId();
    return this.id;
  }

  /**
   * The host terminal's `approvers enroll`: opens the window of the first device with the hash of `code`.
   * Refused while a key is enrolled: only a key adds a key, and `approvers reset` clears them.
   */
  openEnrollment(code: string): Date {
    if (this.store.keys().length > 0)
      throw refuse(
        "approval_enroll_has_keys",
        "a device is enrolled already: add another from it, or run flightdeckd approvers reset to start over",
      );
    const until = new Date(this.opts.now().getTime() + ENROLL_WINDOW_MS);
    this.store.openWindow(sha256Hex(code), until);
    return until;
  }

  /** The enrolled keys, read from the store on every call. */
  keys(): EnrolledKey[] {
    return this.store.keys().map(({ keyId, publicKey }) => ({ keyId, publicKey }));
  }

  list(): { daemonId: string; protectionOff: boolean; keys: ApprovalKeyInfo[] } {
    const keys = this.store.keys().map(({ keyId, name, client, address, enrolledAt }) => ({
      keyId,
      name,
      client,
      address,
      enrolledAt,
    }));
    return { daemonId: this.daemonId(), protectionOff: keys.length === 0, keys };
  }

  challenge(
    purpose: NoncePurpose,
    requestId: string | undefined,
    connection: number,
  ): { nonce: string; daemonId: string; expiresInMs: number } {
    const nonce = this.nonces.issue(purpose, requestId, connection);
    return { nonce, daemonId: this.daemonId(), expiresInMs: NONCE_TTL_MS };
  }

  enroll(
    payload: CommandPayload<"approval.enroll">,
    asker: Asker,
  ): { keyId: string; daemonId: string } {
    const keys = this.store.keys();
    if (keys.length === 0) this.checkFirst(payload);
    else this.checkAdd(payload, keys);
    const keyId = keyIdOf(payload.publicKey);
    this.store.add({
      keyId,
      publicKey: payload.publicKey,
      name: payload.name,
      client: asker.client,
      address: asker.address,
      enrolledAt: this.opts.now().toISOString(),
    });
    this.store.closeWindow();
    return { keyId, daemonId: this.daemonId() };
  }

  revoke(payload: CommandPayload<"approval.revoke">): { keyId: string } {
    const keys = this.store.keys();
    const signer = keys.find((key) => key.keyId === payload.signerKeyId);
    if (!signer) throw proofRequired();
    const message = revokeMessage({
      keyId: signer.keyId,
      daemonId: this.daemonId(),
      nonce: payload.nonce,
      targetKeyId: payload.targetKeyId,
    });
    this.verified(signer.publicKey, message, payload.signature, payload.nonce, "revoke");
    if (!keys.some((key) => key.keyId === payload.targetKeyId))
      return { keyId: payload.targetKeyId };
    if (keys.length === 1) {
      throw refuse(
        "approval_last_key",
        "the last key stays: only `flightdeckd approvers reset` removes it",
      );
    }
    this.store.remove(payload.targetKeyId);
    return { keyId: payload.targetKeyId };
  }

  /** The first key: the window is open, the key signs its own enrollment, and the code is the one the terminal printed. */
  private checkFirst(payload: CommandPayload<"approval.enroll">): void {
    const window = this.store.window();
    if (!window || window.until.getTime() <= this.opts.now().getTime()) {
      throw refuse(
        "approval_enroll_closed",
        "enrolling is closed: run `flightdeckd approvers enroll` on the host",
      );
    }
    if (!payload.code) throw proofRequired();
    const codeHash = sha256Hex(payload.code);
    const message = enrollFirstMessage({
      daemonId: this.daemonId(),
      nonce: payload.nonce,
      publicKey: payload.publicKey,
      codeHash,
    });
    this.verified(payload.publicKey, message, payload.signature, payload.nonce, "enroll");
    if (!sameHash(codeHash, window.codeHash)) {
      if (this.store.fail() >= MAX_WRONG_CODES) this.store.closeWindow();
      throw proofRequired();
    }
  }

  /** A later key: an enrolled key signs the new one in. */
  private checkAdd(
    payload: CommandPayload<"approval.enroll">,
    keys: ReadonlyArray<EnrolledKey>,
  ): void {
    const signer = keys.find((key) => key.keyId === payload.signerKeyId);
    if (!signer || !isDevicePublicKey(payload.publicKey)) throw proofRequired();
    const message = enrollAddMessage({
      keyId: signer.keyId,
      daemonId: this.daemonId(),
      nonce: payload.nonce,
      newPublicKey: payload.publicKey,
    });
    this.verified(signer.publicKey, message, payload.signature, payload.nonce, "enroll");
  }

  /** The signature holds and its nonce was live: a forged signature never uses a nonce up. */
  private verified(
    publicKey: string,
    message: string,
    signature: string,
    nonce: string,
    purpose: NoncePurpose,
  ): void {
    if (!verifySignature(publicKey, message, signature)) throw proofRequired();
    const taken = this.nonces.take(nonce, purpose);
    if (taken === "unknown") throw proofRequired();
    if (taken === "expired") {
      throw refuse("approval_challenge_expired", "the challenge expired: try again");
    }
  }
}

/** Two hex digests equal, compared in constant time. */
function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
