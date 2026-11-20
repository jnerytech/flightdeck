import {
  type ApprovalKeyInfo,
  type ApprovalProof,
  type ApprovalResults,
  approvalDigests,
  approvalMessage,
  type CommandPayload,
  enrollFirstMessage,
  FEATURE_APPROVAL_PROOF,
  needsApprovalProof,
  PermissionRespondPayload,
  type PermissionUpdate,
  type RiskLevel,
  revokeMessage,
} from "@flightdeck/protocol";
import { refusalText } from "../../i18n/errors.ts";
import type { T } from "../../i18n/index.ts";
import type { AppKernel } from "../../lib/kernel.ts";
import { hasFeature } from "../../lib/version.ts";
import type { Platform } from "../../platform/types.ts";

/** What a host says about its approval devices, and which key is this device's. */
export interface ApprovalStatus {
  /** No key is enrolled: a high-risk allow needs only the hold. */
  protectionOff: boolean;
  keys: ApprovalKeyInfo[];
  /** This device's key id for this host, when it has made one. */
  thisKeyId: string | null;
}

/** What the proof path found: nothing to prove, a proof to send, or the person declined the system's dialog. */
export type ProofResult =
  | { kind: "none" }
  | { kind: "proof"; proof: ApprovalProof }
  | { kind: "declined" };

/** The answer a proof covers: what `permission.respond` carries beside the decision. */
export interface ProofAnswer {
  requestId: string;
  decision: "allow" | "deny";
  updatedPermissions?: PermissionUpdate[] | undefined;
  updatedInput?: Record<string, unknown> | undefined;
  message?: string | undefined;
}

/** What the approval devices read and ask through the app's store. */
export interface ApprovalCore {
  /** The device's key store; none outside the desktop shell. */
  keys(): Platform["approvalKeys"];
  /** What the host announced at connect. */
  host(hostId: string): { features?: readonly string[]; daemonId?: string } | undefined;
  request: AppKernel<object>["hostRequest"];
  /** The app's language ("pt-BR" or "en"), for the system's dialog. */
  lang(): string;
  t(): T;
}

type ApprovalCommand =
  | "approval.list"
  | "approval.challenge"
  | "approval.enroll"
  | "approval.revoke";

/** Lowercase hex SHA-256, as the daemon hashes the same text. */
async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The system's dialog said no: the shell rejects with this word. */
function isDecline(error: unknown): boolean {
  return error === "declined" || (error instanceof Error && error.message === "declined");
}

/**
 * The devices that approve for the person (#3439): the key this device holds for a host, the proof it
 * signs for a high-risk allow, and enrolling and revoking from the host's page. The key never leaves
 * the shell: it signs after a system dialog the person answers.
 */
export class ApprovalSlice {
  constructor(private readonly core: ApprovalCore) {}

  /** This app can hold a key (it runs in the shell) and the host checks proofs. */
  supported(hostId: string): boolean {
    const host = this.core.host(hostId);
    return (
      this.core.keys() !== undefined &&
      !!host?.daemonId &&
      hasFeature(host.features, FEATURE_APPROVAL_PROOF, false)
    );
  }

  async status(hostId: string): Promise<ApprovalStatus> {
    const list = await this.ask(hostId, "approval.list", {});
    const local = await this.keyStore().get(this.daemonOf(hostId));
    return { protectionOff: list.protectionOff, keys: list.keys, thisKeyId: local?.keyId ?? null };
  }

  /**
   * Makes this device's key for the host and enrolls it with the code the host's terminal printed.
   * "declined" is the person saying no to the system's dialog: nothing was sent and the key is dropped.
   */
  async enroll(hostId: string, name: string, code: string): Promise<"done" | "declined"> {
    const keys = this.keyStore();
    const daemonId = this.daemonOf(hostId);
    const listed = await this.ask(hostId, "approval.list", {});
    const existing = await keys.get(daemonId);
    if (existing) {
      if (listed.keys.some((key) => key.keyId === existing.keyId)) {
        throw new Error(this.core.t()("approvalDevices.hasKeyHere"));
      }
      // A key the host does not list is left over (a reset at the host): replace it.
      await keys.delete(daemonId);
    }
    const key = await keys.create(daemonId);
    try {
      const challenge = await this.ask(hostId, "approval.challenge", { purpose: "enroll" });
      const message = enrollFirstMessage({
        daemonId: challenge.daemonId,
        nonce: challenge.nonce,
        publicKey: key.publicKey,
        codeHash: await sha256Hex(code),
      });
      const signature = await keys.sign(daemonId, message, this.core.lang());
      await this.ask(hostId, "approval.enroll", {
        publicKey: key.publicKey,
        name,
        nonce: challenge.nonce,
        signature,
        code,
      });
      return "done";
    } catch (error) {
      // A decline sent nothing, so the key goes. Any other error can come after the host took the key
      // (a timeout, a dropped socket): dropping the private half then would lock the person out of
      // high-risk approvals, so it stays when the host lists it, or when that cannot be told.
      const declined = isDecline(error);
      if (declined || !(await this.hostTrusts(hostId, key.keyId))) await keys.delete(daemonId);
      if (declined) return "declined";
      throw error;
    }
  }

  /** Removes `targetKeyId` from the host, signed by this device's key. "declined": the person said no. */
  async revoke(hostId: string, targetKeyId: string): Promise<"done" | "declined"> {
    const keys = this.keyStore();
    const daemonId = this.daemonOf(hostId);
    const local = await keys.get(daemonId);
    if (!local) throw new Error(this.core.t()("approvalDevices.noKeyHere"));
    const challenge = await this.ask(hostId, "approval.challenge", { purpose: "revoke" });
    const message = revokeMessage({
      keyId: local.keyId,
      daemonId: challenge.daemonId,
      nonce: challenge.nonce,
      targetKeyId,
    });
    let signature: string;
    try {
      signature = await keys.sign(daemonId, message, this.core.lang());
    } catch (error) {
      if (isDecline(error)) return "declined";
      throw error;
    }
    await this.ask(hostId, "approval.revoke", {
      targetKeyId,
      signerKeyId: local.keyId,
      nonce: challenge.nonce,
      signature,
    });
    return "done";
  }

  /** Forgets this device's key for the host; the host keeps it listed until another device revokes it. */
  async removeLocalKey(hostId: string): Promise<void> {
    await this.keyStore().delete(this.daemonOf(hostId));
  }

  /**
   * The proof an allow needs, or none when it needs none (a deny, a host that does not check proofs, a
   * host with no key enrolled, a low-risk allow that saves no rule). It throws, with the person's text,
   * when a proof is needed and cannot be made.
   */
  async prove(
    hostId: string,
    answer: ProofAnswer,
    risk: RiskLevel | undefined,
  ): Promise<ProofResult> {
    // A risk the app could not read is treated as high: on a protected host that asks for the proof.
    if (
      answer.decision !== "allow" ||
      !needsApprovalProof(risk ?? "high", answer.updatedPermissions)
    ) {
      return { kind: "none" };
    }
    const keys = this.core.keys();
    if (!keys || !this.supported(hostId)) return { kind: "none" };
    const list = await this.ask(hostId, "approval.list", {});
    if (list.protectionOff) return { kind: "none" };
    const daemonId = this.daemonOf(hostId);
    const local = await keys.get(daemonId);
    if (!local || !list.keys.some((key) => key.keyId === local.keyId)) {
      throw new Error(this.core.t()("approvalDevices.noKeyHere"));
    }
    const challenge = await this.ask(hostId, "approval.challenge", {
      purpose: "approve",
      requestId: answer.requestId,
    });
    // What the host hashes is the parsed payload, so the device hashes the parsed one too.
    const parsed = PermissionRespondPayload.parse(answer);
    const digests = approvalDigests(parsed);
    const message = approvalMessage({
      keyId: local.keyId,
      daemonId: challenge.daemonId,
      requestId: answer.requestId,
      nonce: challenge.nonce,
      permissionsHash: await sha256Hex(digests.permissions),
      inputHash: await sha256Hex(digests.input),
      messageHash: await sha256Hex(digests.message),
    });
    try {
      const signature = await keys.sign(daemonId, message, this.core.lang());
      return { kind: "proof", proof: { keyId: local.keyId, nonce: challenge.nonce, signature } };
    } catch (error) {
      if (isDecline(error)) return { kind: "declined" };
      throw error;
    }
  }

  /** The host lists `keyId`, or its list cannot be read (then the key is kept, never guessed gone). */
  private async hostTrusts(hostId: string, keyId: string): Promise<boolean> {
    try {
      const listed = await this.ask(hostId, "approval.list", {});
      return listed.keys.some((key) => key.keyId === keyId);
    } catch {
      return true;
    }
  }

  private keyStore(): NonNullable<Platform["approvalKeys"]> {
    const keys = this.core.keys();
    if (!keys) throw new Error(this.core.t()("approvalDevices.noKeyHere"));
    return keys;
  }

  private daemonOf(hostId: string): string {
    const daemonId = this.core.host(hostId)?.daemonId;
    if (!daemonId) throw new Error(this.core.t()("approvalDevices.loadFailed"));
    return daemonId;
  }

  /** One approval command to the host; a refusal becomes an error with the person's text. */
  private async ask<C extends ApprovalCommand>(
    hostId: string,
    type: C,
    payload: CommandPayload<C>,
  ): Promise<ApprovalResults[C]> {
    const result = await this.core.request(hostId, type, payload);
    if (result.ok) return result.data as ApprovalResults[C];
    const why = {
      ...(result.reason ? { reason: result.reason } : {}),
      ...(result.params ? { params: result.params } : {}),
    };
    throw new Error(refusalText(result.code, result.message, this.core.t(), why));
  }
}
