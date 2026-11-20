import type {
  ApprovalKeyInfo,
  ApprovalProof,
  PermissionUpdate,
  RiskLevel,
} from "@flightdeck/protocol";
import type { T } from "../../i18n/index.ts";
import type { AppKernel } from "../../lib/kernel.ts";
import type { Platform } from "../../platform/types.ts";

/** What a host says about its approval devices, and whether this device holds one of them. */
export interface ApprovalStatus {
  /** No key is enrolled: a high-risk allow needs only the hold. */
  protectionOff: boolean;
  keys: ApprovalKeyInfo[];
  /** This device's key id for this host, when it has made one. */
  thisKeyId: string | null;
}

/** What the proof path found: nothing to prove, a proof to send, or the person declined the system dialog. */
export type ProofResult =
  | { kind: "none" }
  | { kind: "proof"; proof: ApprovalProof }
  | { kind: "declined" };

/** The answer a proof covers: the fields `permission.respond` carries beside the decision. */
export interface ProofAnswer {
  requestId: string;
  decision: "allow" | "deny";
  updatedPermissions?: PermissionUpdate[] | undefined;
  updatedInput?: Record<string, unknown> | undefined;
  message?: string | undefined;
}

/** What the approval devices read and ask through the app's store. */
export interface ApprovalCore {
  keys(): Platform["approvalKeys"];
  /** What the host announced at connect: its features and its daemon id. */
  host(hostId: string): { features?: readonly string[]; daemonId?: string } | undefined;
  request: AppKernel<object>["hostRequest"];
  /** The app's language ("pt-BR" or "en"), for the system's dialog. */
  lang(): string;
  t(): T;
}

/**
 * The devices that approve for the person (#3439): the key this device holds for a host, the proof it
 * signs for a high-risk allow, and enrolling and revoking from the host's page.
 */
export class ApprovalSlice {
  constructor(private readonly core: ApprovalCore) {}

  /** This app can hold a key (it runs in the shell) and the host checks proofs. */
  supported(_hostId: string): boolean {
    return false;
  }

  async status(_hostId: string): Promise<ApprovalStatus> {
    return { protectionOff: true, keys: [], thisKeyId: null };
  }

  /** Makes this device's key for the host and enrolls it with the code the host's terminal printed. */
  async enroll(_hostId: string, _name: string, _code: string): Promise<void> {
    void this.core;
  }

  async revoke(_hostId: string, _targetKeyId: string): Promise<void> {}

  /** Forgets this device's key for the host; the host keeps it listed until another device revokes it. */
  async removeLocalKey(_hostId: string): Promise<void> {}

  /** The proof an allow needs, or none when it needs none; throws with the person's text when it cannot be made. */
  async prove(
    _hostId: string,
    _answer: ProofAnswer,
    _risk: RiskLevel | undefined,
  ): Promise<ProofResult> {
    return { kind: "none" };
  }
}
