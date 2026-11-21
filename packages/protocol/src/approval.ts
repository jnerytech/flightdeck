// The proof of an approval (#3439): what a person's device signs before a high-risk allow, and the
// commands that enroll the device. The bytes a device signs are built here, once, so the app and the
// daemon cannot disagree about them; hashing and signing stay with each side (WebCrypto in the app,
// node:crypto in the daemon).
import { z } from "zod";
import { cmd } from "./command.ts";

/** The host checks a signed proof of the person's device before a high-risk allow (`host.info.features`). */
export const FEATURE_APPROVAL_PROOF = "approval-proof";

/** The host announces `approval.enrolled` and `approval.revoked` to a client that sent `approval.watch` (#3476). */
export const FEATURE_APPROVAL_WATCH = "approval-watch";

/** The host checks a signed proof of the person's device before it approves a prod or high-risk secret use (#3452). */
export const FEATURE_APPROVAL_VAULT = "approval-vault";

/** The host checks a signed proof of the person's device before a command that moves code or trust (#3453). */
export const FEATURE_APPROVAL_COMMAND = "approval-command";

/** The host checks a signed proof of the person's device before it turns bypass on with `host.bypass` (#3507). */
export const FEATURE_APPROVAL_BYPASS = "approval-bypass";

/** The host checks a signed proof of the person's device before it adds an allowed folder with `roots.add` (#3507). */
export const FEATURE_APPROVAL_ROOTS = "approval-roots";

/** The host checks a signed proof of the person's device before it writes a project's Claude Code setup with `project.harness.apply` (#3507). */
export const FEATURE_APPROVAL_HARNESS = "approval-harness";

/** The host checks a signed proof of the person's device before it installs or updates a plugin with `plugins.install` or `plugins.update` (#3516). */
export const FEATURE_APPROVAL_PLUGINS = "approval-plugins";

/** The host checks a signed proof of the person's device before it adds a plugin marketplace with `plugins.marketplaceAdd` (#3516). */
export const FEATURE_APPROVAL_MARKETPLACE = "approval-marketplace";

/** The host checks a signed proof of the person's device before it trusts a project's snippet file with `snippets.trust` (#3647). */
export const FEATURE_APPROVAL_SNIPPETS = "approval-snippets";

/** The host checks a signed proof of the person's device before it trusts a project folder (#3453). */
export const FEATURE_APPROVAL_TRUST = "approval-trust";

/** The host checks a signed proof of the person's device before it resumes the automatic approver of a session (#3453). */
export const FEATURE_APPROVAL_RESUME = "approval-resume";

/** The commands whose payload an enrolled device signs (#3453); one list for the host and the app. */
export const PROOF_COMMANDS = [
  "card.pr.merge",
  "project.trust.set",
  "autoapprove.resume",
  "host.bypass",
  "roots.add",
  "project.harness.apply",
  "plugins.install",
  "plugins.update",
  "plugins.marketplaceAdd",
  "snippets.trust",
] as const;
export type ProofCommand = (typeof PROOF_COMMANDS)[number];

/** The payload field whose value `false` lowers risk, so the command is open for it: the rest of a gated command is gated. */
const NARROWING_FIELD: Partial<Record<string, string>> = {
  "project.trust.set": "trusted",
  "host.bypass": "allow",
};

/**
 * Whether `command` with this payload needs a device's proof when a key is enrolled. Fails closed:
 * a trust set or a bypass switch is open only for the value `false`, which lowers risk; a missing or
 * odd value is gated.
 */
export function commandNeedsProof(command: string, payload: unknown): boolean {
  if (!(PROOF_COMMANDS as readonly string[]).includes(command)) return false;
  const field = NARROWING_FIELD[command];
  if (field === undefined) return true;
  return (payload as Record<string, unknown> | null | undefined)?.[field] !== false;
}

/**
 * Whether one rule of a secret loosens what is asked: its decision or its outsideWindow is `allow`. An item that is
 * not a rule is taken as loosening, never let through unread. The one definition: the host's ceiling and the gate of
 * `vault.rules.set` both read it (#3754).
 */
export function ruleLoosens(_rule: unknown): boolean {
  return false;
}

/** The text a device hashes for a command: the payload without its `proof`, as canonical JSON. */
export function commandDigest(payload: Record<string, unknown>): string {
  const { proof: _proof, ...bound } = payload;
  return canonicalJson(bound);
}

/** What an enrolled device signs to run `command` with the payload whose digest hashes to `payloadHash`. */
export function commandMessage(parts: {
  keyId: string;
  daemonId: string;
  command: string;
  nonce: string;
  payloadHash: string;
}): string {
  return canonicalJson([
    "flightdeck/command/v1",
    parts.keyId,
    parts.daemonId,
    parts.command,
    parts.nonce,
    parts.payloadHash,
  ]);
}

/** `<` on strings compares UTF-16 code units, the order RFC 8785 asks for. */
function byCodeUnit(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/**
 * RFC 8785 canonical JSON: no spaces, object keys in UTF-16 code unit order (never a locale's), numbers and
 * strings as `JSON.stringify` writes them. A key whose value is `undefined` is left out; a number that is
 * not finite, or a value JSON cannot carry, throws.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("canonicalJson: a number must be finite");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => (item === undefined ? "null" : canonicalJson(item))).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort(byCodeUnit);
    const members = keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${members.join(",")}}`;
  }
  throw new TypeError(`canonicalJson: a ${typeof value} cannot be signed`);
}

/** An allow needs the proof of a device when the request is high risk, or when it saves rules. */
export function needsApprovalProof(
  // Written out, not `RiskLevel`: permissions.ts imports this file, and a type import back would be a cycle.
  risk: "low" | "medium" | "high",
  updatedPermissions: readonly unknown[] | undefined,
): boolean {
  return risk === "high" || (updatedPermissions?.length ?? 0) > 0;
}

/** The three texts of a `permission.respond` allow that a proof binds; each side hashes them with SHA-256. */
export interface ApprovalAnswer {
  updatedPermissions?: unknown[];
  updatedInput?: Record<string, unknown>;
  message?: string;
}

export interface ApprovalDigests {
  permissions: string;
  input: string;
  message: string;
}

/** What the allow carries, as the texts the device hashes: the saved rules, the changed input and the message. */
export function approvalDigests(answer: ApprovalAnswer): ApprovalDigests {
  return {
    permissions: canonicalJson(answer.updatedPermissions ?? []),
    input: canonicalJson(answer.updatedInput ?? null),
    message: answer.message ?? "",
  };
}

/** What a device signs to allow request `requestId`; the three hashes are lowercase hex SHA-256 of `approvalDigests`. */
export function approvalMessage(parts: {
  keyId: string;
  daemonId: string;
  requestId: string;
  nonce: string;
  permissionsHash: string;
  inputHash: string;
  messageHash: string;
}): string {
  const { keyId, daemonId, requestId, nonce, permissionsHash, inputHash, messageHash } = parts;
  return canonicalJson([
    "flightdeck/approval/v1",
    keyId,
    daemonId,
    requestId,
    nonce,
    "allow",
    permissionsHash,
    inputHash,
    messageHash,
  ]);
}

/** What the first device signs to enroll: its own key, with the hash of the one-time code the host printed. */
export function enrollFirstMessage(parts: {
  daemonId: string;
  nonce: string;
  publicKey: string;
  codeHash: string;
}): string {
  return canonicalJson([
    "flightdeck/enroll-first/v1",
    parts.daemonId,
    parts.nonce,
    parts.publicKey,
    parts.codeHash,
  ]);
}

/** What an enrolled device signs to add another key. */
export function enrollAddMessage(parts: {
  keyId: string;
  daemonId: string;
  nonce: string;
  newPublicKey: string;
}): string {
  return canonicalJson([
    "flightdeck/enroll-add/v1",
    parts.keyId,
    parts.daemonId,
    parts.nonce,
    parts.newPublicKey,
  ]);
}

/** What an enrolled device signs to approve the use of a secret for request `requestId`, for `scope` (#3452). */
export function vaultApproveMessage(parts: {
  keyId: string;
  daemonId: string;
  requestId: string;
  nonce: string;
  scope: "once" | "session";
}): string {
  return canonicalJson([
    "flightdeck/vault-approve/v1",
    parts.keyId,
    parts.daemonId,
    parts.requestId,
    parts.nonce,
    parts.scope,
  ]);
}

/** What an enrolled device signs to revoke `targetKeyId` (its own or another's). */
export function revokeMessage(parts: {
  keyId: string;
  daemonId: string;
  nonce: string;
  targetKeyId: string;
}): string {
  return canonicalJson([
    "flightdeck/revoke/v1",
    parts.keyId,
    parts.daemonId,
    parts.nonce,
    parts.targetKeyId,
  ]);
}

/** A proof that rides with `permission.respond`: which key signed, over which challenge. */
export const ApprovalProof = z.object({
  keyId: z.string().min(1).max(128),
  nonce: z.string().min(1).max(128),
  /** Base64 of the 64-byte IEEE P1363 ECDSA P-256 signature. */
  signature: z.string().min(1).max(256),
});
export type ApprovalProof = z.infer<typeof ApprovalProof>;

const Base64 = z.string().min(1).max(512);

/** The commands of the approval proof; index.ts spreads them into `Command`. */
export const approvalCommands = [
  /** A fresh nonce, good once for 60 seconds: for an open request that needs a proof, or for an enrollment or revoke. */
  cmd(
    "approval.challenge",
    z.discriminatedUnion("purpose", [
      z.object({ purpose: z.literal("approve"), requestId: z.string().min(1) }).strict(),
      z.object({ purpose: z.literal("enroll") }).strict(),
      z.object({ purpose: z.literal("revoke") }).strict(),
      z.object({ purpose: z.literal("command"), command: z.enum(PROOF_COMMANDS) }).strict(),
    ]),
  ),
  /**
   * Enrolls a device key. The first one comes with the one-time code the host terminal printed
   * (`flightdeckd approvers enroll`); later ones are signed by a key already enrolled.
   */
  cmd(
    "approval.enroll",
    z
      .object({
        publicKey: Base64,
        name: z.string().min(1).max(64),
        nonce: z.string().min(1).max(128),
        signature: z.string().min(1).max(256),
        code: z.string().min(1).max(256).optional(),
        signerKeyId: z.string().min(1).max(128).optional(),
      })
      .strict(),
  ),
  /** Revokes a key; signed by an enrolled one. The last key stays: only `flightdeckd approvers reset` removes it. */
  cmd(
    "approval.revoke",
    z
      .object({
        targetKeyId: z.string().min(1).max(128),
        signerKeyId: z.string().min(1).max(128),
        nonce: z.string().min(1).max(128),
        signature: z.string().min(1).max(256),
      })
      .strict(),
  ),
  cmd("approval.list", z.object({}).strict()),
  /** Streams `approval.enrolled` and `approval.revoked` from now on, until the connection closes (#3476). */
  cmd("approval.watch", z.object({}).strict()),
] as const;

export interface ApprovalKeyInfo {
  keyId: string;
  name: string;
  /** The name the app said hello with when it enrolled. */
  client: string;
  enrolledAt: string;
  /** The address the daemon saw when it enrolled. */
  address: string;
}

/** The `data` of each approval command's ack; `CommandResults` extends it. */
export interface ApprovalResults {
  "approval.challenge": { nonce: string; daemonId: string; expiresInMs: number };
  "approval.enroll": { keyId: string; daemonId: string };
  "approval.revoke": { keyId: string };
  "approval.list": {
    daemonId: string;
    /** No key is enrolled: a high-risk allow needs only the hold, as before. */
    protectionOff: boolean;
    keys: ApprovalKeyInfo[];
  };
  "approval.watch": undefined;
}

/** Sent after `approval.watch` when a device is enrolled: who it is and where it came from, never a key, a nonce or a code. */
export const ApprovalEnrolled = z.object({
  type: z.literal("approval.enrolled"),
  keyId: z.string(),
  name: z.string(),
  client: z.string(),
  address: z.string(),
  enrolledAt: z.string(),
});
export type ApprovalEnrolled = z.infer<typeof ApprovalEnrolled>;

/** Sent after `approval.watch` when a device is revoked. */
export const ApprovalRevoked = z.object({
  type: z.literal("approval.revoked"),
  keyId: z.string(),
});
export type ApprovalRevoked = z.infer<typeof ApprovalRevoked>;
