import {
  type ApprovalEnrolled,
  type ApprovalKeyInfo,
  type ApprovalProof,
  type ApprovalResults,
  type ApprovalRevoked,
  approvalDigests,
  approvalMessage,
  type CommandPayload,
  commandDigest,
  commandMessage,
  enrollAddMessage,
  enrollFirstMessage,
  FEATURE_APPROVAL_BYPASS,
  FEATURE_APPROVAL_COMMAND,
  FEATURE_APPROVAL_HARNESS,
  FEATURE_APPROVAL_PROOF,
  FEATURE_APPROVAL_RESUME,
  FEATURE_APPROVAL_ROOTS,
  FEATURE_APPROVAL_TRUST,
  FEATURE_APPROVAL_VAULT,
  type HARNESS_PREVIEW_PARTS,
  needsApprovalProof,
  PermissionRespondPayload,
  type PermissionUpdate,
  type ProofCommand,
  type RiskLevel,
  revokeMessage,
  vaultApproveMessage,
} from "@flightdeck/protocol";
import { refusalText } from "../../i18n/errors.ts";
import type { T } from "../../i18n/index.ts";
import type { AppKernel, HostResult } from "../../lib/kernel.ts";
import { hasFeature } from "../../lib/version.ts";
import type { Platform } from "../../platform/types.ts";
import { decodeAdd, encodeAdd, fingerprintOf, isDeviceName, keyIdOf } from "./add-text.ts";

/** The payload of a guarded merge, or the person's no (#3453). */
type MergePayload = { kind: "payload"; payload: MergeBody } | { kind: "declined" };

/** The payload of `roots.add`, or the person's no (#3507). */
type RootsPayload =
  | { kind: "payload"; payload: { path: string; confirm: true; proof?: ApprovalProof } }
  | { kind: "declined" };

/** The payload of `project.harness.apply`, or the person's no (#3507). */
type HarnessPayload =
  | { kind: "payload"; payload: HarnessBody & { proof?: ApprovalProof } }
  | { kind: "declined" };

/** What `project.harness.apply` asks for: the folder, the parts, the preview's digests and the options. */
export interface HarnessBody {
  path: string;
  parts: Array<(typeof HARNESS_PREVIEW_PARTS)[number]>;
  digests: Record<string, string>;
  confirm: true;
  reformat?: true;
  template?: string;
}

/** The payload of `host.bypass` that turns bypass on, or the person's no (#3507). */
type BypassPayload = { kind: "payload"; payload: BypassBody } | { kind: "declined" };

/** `host.bypass` turning bypass on: the proof is there only for a host that checks it and has a device enrolled. */
interface BypassBody {
  allow: true;
  confirm: true;
  proof?: ApprovalProof;
}

/** `card.pr.merge`'s payload: the head binding and the proof are there only for a host that checks them. */
interface MergeBody {
  cardId: string;
  method: "merge" | "squash";
  confirm: boolean;
  prUrl?: string;
  headSha?: string;
  proof?: { keyId: string; nonce: string; signature: string };
}

/** The payload of `project.trust.set`, or the person's no (#3453). */
type TrustPayload =
  | {
      kind: "payload";
      payload: {
        path: string;
        trusted: boolean;
        proof?: { keyId: string; nonce: string; signature: string };
      };
    }
  | { kind: "declined" };

/** The payload of `autoapprove.resume`, or the person's no (#3453). */
type ResumePayload =
  | {
      kind: "payload";
      payload: {
        sessionKey: string;
        confirm: boolean;
        proof?: { keyId: string; nonce: string; signature: string };
      };
    }
  | { kind: "declined" };

/** The feature a host announces for each command it guards (#3453). */
const COMMAND_FEATURE: Partial<Record<ProofCommand, string>> = {
  "card.pr.merge": FEATURE_APPROVAL_COMMAND,
  "project.trust.set": FEATURE_APPROVAL_TRUST,
  "host.bypass": FEATURE_APPROVAL_BYPASS,
  "autoapprove.resume": FEATURE_APPROVAL_RESUME,
  "roots.add": FEATURE_APPROVAL_ROOTS,
  "project.harness.apply": FEATURE_APPROVAL_HARNESS,
};

/** A command a host from before its proof does not guard: the devices panel says so for each. */
export type UncheckedCommand = "merge" | "trust" | "bypass" | "resume" | "roots" | "harness";

/** What a host says about its approval devices, and which key is this device's. */
export interface ApprovalStatus {
  /** No key is enrolled: a high-risk allow needs only the hold. */
  protectionOff: boolean;
  keys: ApprovalKeyInfo[];
  /** This device's key id for this host, when it has made one. */
  thisKeyId: string | null;
}

/** What a new device shows for an enrolled one to add it. */
export interface AddRequest {
  text: string;
  fingerprint: string;
}

/** What an enrolled device read from that text, to show the person before it signs. */
export interface AddOffer {
  name: string;
  publicKey: string;
  fingerprint: string;
  /** The first 8 characters of the host's id, as the system's dialog names it. */
  host: string;
}

/** A change a host announced about its devices that this app did not make (#3477). */
export interface ApprovalHeard {
  kind: "enrolled" | "revoked";
  /** The name the new device gave; set for "enrolled". */
  name?: string;
  /** The key is this device's own. */
  own: boolean;
}

/** A name the host sent, as plain text: control and bidirectional characters out, at most 64 long. */
function deviceName(name: string | undefined): string {
  return (name ?? "").replace(/[\p{Cc}\p{Cf}]/gu, "").slice(0, 64);
}

/** The one line a change is told in, on the host's page and in a notice. */
export function heardText(t: T, heard: ApprovalHeard, host: string): string {
  if (heard.kind === "enrolled") {
    return t("approvalDevices.heardEnrolled", { name: deviceName(heard.name), host });
  }
  return t(heard.own ? "approvalDevices.heardRevokedOwn" : "approvalDevices.heardRevoked", {
    host,
  });
}

/** How loud a change is told: a device nobody here made, or this device's own key gone, is an alert. */
export function heardTone(heard: ApprovalHeard): "error" | "info" {
  return heard.kind === "enrolled" || heard.own ? "error" : "info";
}

/** This device's key for one host, as the proof paths use it. */
interface Signer {
  keys: NonNullable<Platform["approvalKeys"]>;
  daemonId: string;
  local: { keyId: string };
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
  host(
    hostId: string,
  ): { features?: readonly string[]; daemonId?: string; name?: string } | undefined;
  /** A short notice, already translated: `fail` is the loud one (an alert), `success` a quiet one. */
  success(text: string): void;
  fail(text: string): void;
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
  private readonly listeners = new Map<string, Set<(heard: ApprovalHeard) => void>>();
  /** Keys (as `host/keyId`) this app is revoking right now: the host's announcement of them is its own doing. */
  private readonly revoking = new Set<string>();
  /** The same for a device this app is adding with the person's agreement (#3478). */
  private readonly adding = new Set<string>();

  constructor(private readonly core: ApprovalCore) {}

  /** Calls `listener` with each change a host announces (the host's page shows it); returns the way to stop. */
  subscribe(hostId: string, listener: (heard: ApprovalHeard) => void): () => void {
    const watchers = this.listeners.get(hostId) ?? new Set();
    this.listeners.set(hostId, watchers);
    watchers.add(listener);
    return () => {
      watchers.delete(listener);
      if (watchers.size === 0) this.listeners.delete(hostId);
    };
  }

  /**
   * A host announced a device enrolled or revoked (#3477). This device's own enrollment, a device this
   * app is adding and a revoke this app is making are the person's own doing and stay quiet. The rest goes to the page that
   * watches the host, or, with none open, to a notice: an alert for a device nobody here made or for
   * this device's own key revoked, a quiet one for another device's.
   */
  async onChange(hostId: string, change: ApprovalEnrolled | ApprovalRevoked): Promise<void> {
    // Before the first await: the revoke's answer may follow the announcement closely.
    if (change.type === "approval.revoked" && this.revoking.has(`${hostId}/${change.keyId}`))
      return;
    const added =
      change.type === "approval.enrolled" && this.adding.has(`${hostId}/${change.keyId}`);
    const host = this.core.host(hostId);
    const own = (await this.localKeyId(host?.daemonId)) === change.keyId;
    let heard: ApprovalHeard;
    if (change.type === "approval.enrolled") {
      // Made here, by this device or by the person's agreement: no news, but a watching page reads the list again.
      heard = { kind: "enrolled", name: change.name, own: own || added };
      if (heard.own) {
        for (const listener of [...(this.listeners.get(hostId) ?? [])]) listener(heard);
        return;
      }
    } else {
      heard = { kind: "revoked", own };
    }
    const watchers = this.listeners.get(hostId);
    if (watchers?.size) {
      for (const listener of [...watchers]) listener(heard);
      return;
    }
    const text = heardText(this.core.t(), heard, host?.name ?? hostId);
    if (heard.kind === "revoked" && !heard.own) this.core.success(text);
    else this.core.fail(text);
  }

  private async localKeyId(daemonId: string | undefined): Promise<string | null> {
    const keys = this.core.keys();
    if (!keys || !daemonId) return null;
    try {
      return (await keys.get(daemonId))?.keyId ?? null;
    } catch {
      return null;
    }
  }

  /**
   * The host checks the proof of an allow but not of a merge (#3453): it is from before the commands were
   * guarded, so its merges ask for no device. A host the app has no features for is not said to be one.
   */
  uncheckedCommands(hostId: string): UncheckedCommand[] {
    const features = this.core.host(hostId)?.features;
    if (features === undefined || !hasFeature(features, FEATURE_APPROVAL_PROOF, false)) return [];
    const unchecked: UncheckedCommand[] = [];
    if (!hasFeature(features, FEATURE_APPROVAL_COMMAND, false)) unchecked.push("merge");
    if (!hasFeature(features, FEATURE_APPROVAL_TRUST, false)) unchecked.push("trust");
    if (!hasFeature(features, FEATURE_APPROVAL_BYPASS, false)) unchecked.push("bypass");
    if (!hasFeature(features, FEATURE_APPROVAL_RESUME, false)) unchecked.push("resume");
    if (!hasFeature(features, FEATURE_APPROVAL_ROOTS, false)) unchecked.push("roots");
    if (!hasFeature(features, FEATURE_APPROVAL_HARNESS, false)) unchecked.push("harness");
    return unchecked;
  }

  /** This app can hold a key (it runs in the shell) and the host checks proofs. */
  supported(hostId: string, feature: string = FEATURE_APPROVAL_PROOF): boolean {
    const host = this.core.host(hostId);
    return (
      this.core.keys() !== undefined &&
      !!host?.daemonId &&
      hasFeature(host.features, feature, false)
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

  /**
   * A new device's side of adding it (#3478): its key for the host, and the text to carry to an enrolled
   * device. A key the host does not list is the one waiting to be added, so it is reused.
   */
  async requestAdd(hostId: string, name: string): Promise<AddRequest> {
    const t = this.core.t();
    if (!isDeviceName(name)) throw new Error(t("approvalDevices.addBadName"));
    const keys = this.keyStore();
    const daemonId = this.daemonOf(hostId);
    const listed = await this.ask(hostId, "approval.list", {});
    const existing = await keys.get(daemonId);
    if (existing && listed.keys.some((key) => key.keyId === existing.keyId)) {
      throw new Error(t("approvalDevices.hasKeyHere"));
    }
    const key = existing ?? (await keys.create(daemonId));
    return {
      text: encodeAdd({ daemonId, publicKey: key.publicKey, name: name.trim() }),
      fingerprint: await fingerprintOf(key.publicKey),
    };
  }

  /** An enrolled device's side: reads the text, checks it is fit for this host, and says what it would add. */
  async readAdd(hostId: string, text: string): Promise<AddOffer> {
    const t = this.core.t();
    const keys = this.keyStore();
    const daemonId = this.daemonOf(hostId);
    const read = decodeAdd(text);
    if (!read) throw new Error(t("approvalDevices.addBadText"));
    if (read.daemonId !== daemonId) throw new Error(t("approvalDevices.addOtherHost"));
    const listed = await this.ask(hostId, "approval.list", {});
    const local = await keys.get(daemonId);
    if (!local || !listed.keys.some((key) => key.keyId === local.keyId)) {
      throw new Error(t("approvalDevices.noKeyHere"));
    }
    if (read.publicKey === local.publicKey) throw new Error(t("approvalDevices.addAlready"));
    const fingerprint = await fingerprintOf(read.publicKey);
    // The list names keys by id, not by public key: the id is what the new key would be listed under.
    const newId = await keyIdOf(read.publicKey);
    if (listed.keys.some((key) => key.keyId === newId))
      throw new Error(t("approvalDevices.addAlready"));
    return { name: read.name, publicKey: read.publicKey, fingerprint, host: daemonId.slice(0, 8) };
  }

  /** Signs the add of what `readAdd` showed, after the system's dialog, and sends it. */
  async confirmAdd(hostId: string, offer: AddOffer): Promise<"done" | "declined"> {
    const keys = this.keyStore();
    const daemonId = this.daemonOf(hostId);
    const local = await keys.get(daemonId);
    if (!local) throw new Error(this.core.t()("approvalDevices.noKeyHere"));
    const challenge = await this.ask(hostId, "approval.challenge", { purpose: "enroll" });
    const message = enrollAddMessage({
      keyId: local.keyId,
      daemonId: challenge.daemonId,
      nonce: challenge.nonce,
      newPublicKey: offer.publicKey,
    });
    let signature: string;
    try {
      signature = await keys.sign(daemonId, message, this.core.lang());
    } catch (error) {
      if (isDecline(error)) return "declined";
      throw error;
    }
    // The host announces the add before it answers: the person just agreed to it, so it is not news.
    const adding = `${hostId}/${await keyIdOf(offer.publicKey)}`;
    this.adding.add(adding);
    try {
      await this.ask(hostId, "approval.enroll", {
        publicKey: offer.publicKey,
        name: offer.name,
        nonce: challenge.nonce,
        signature,
        signerKeyId: local.keyId,
      });
    } finally {
      this.adding.delete(adding);
    }
    return "done";
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
    // The host announces the revoke before it answers: it is this app's own, so it is not news.
    const revoke = `${hostId}/${targetKeyId}`;
    this.revoking.add(revoke);
    try {
      await this.ask(hostId, "approval.revoke", {
        targetKeyId,
        signerKeyId: local.keyId,
        nonce: challenge.nonce,
        signature,
      });
    } finally {
      this.revoking.delete(revoke);
    }
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
    const signer = await this.signer(hostId, FEATURE_APPROVAL_PROOF);
    if (!signer) return { kind: "none" };
    const challenge = await this.ask(hostId, "approval.challenge", {
      purpose: "approve",
      requestId: answer.requestId,
    });
    // What the host hashes is the parsed payload, so the device hashes the parsed one too.
    const parsed = PermissionRespondPayload.parse(answer);
    const digests = approvalDigests(parsed);
    const message = approvalMessage({
      keyId: signer.local.keyId,
      daemonId: challenge.daemonId,
      requestId: answer.requestId,
      nonce: challenge.nonce,
      permissionsHash: await sha256Hex(digests.permissions),
      inputHash: await sha256Hex(digests.input),
      messageHash: await sha256Hex(digests.message),
    });
    return await this.signed(signer, challenge.nonce, message);
  }

  /**
   * The proof of a prod or high-risk secret use (#3452): the device's signature over this request and
   * the scope approved. The same results as `prove`; none when the host takes the hold instead.
   */
  async proveVault(
    hostId: string,
    requestId: string,
    scope: "once" | "session",
  ): Promise<ProofResult> {
    const signer = await this.signer(hostId, FEATURE_APPROVAL_VAULT);
    if (!signer) return { kind: "none" };
    const challenge = await this.ask(hostId, "approval.challenge", {
      purpose: "approve",
      requestId,
    });
    const message = vaultApproveMessage({
      keyId: signer.local.keyId,
      daemonId: challenge.daemonId,
      requestId,
      nonce: challenge.nonce,
      scope,
    });
    return await this.signed(signer, challenge.nonce, message);
  }

  /**
   * The proof of a command that moves code or trust (#3453): the device's signature over the command and a
   * hash of the payload it sends. The shell gets that payload too, to say in its dialog what the command
   * does; it signs only when the payload is the one the hash is of. The same results as `prove`.
   */
  async proveCommand(
    hostId: string,
    command: ProofCommand,
    payload: Record<string, unknown>,
  ): Promise<ProofResult> {
    // A command no host guards yet (it has no feature) is never proved.
    const feature = COMMAND_FEATURE[command];
    const signer = feature === undefined ? null : await this.signer(hostId, feature);
    if (!signer) return { kind: "none" };
    const challenge = await this.ask(hostId, "approval.challenge", { purpose: "command", command });
    const digest = commandDigest(payload);
    const message = commandMessage({
      keyId: signer.local.keyId,
      daemonId: challenge.daemonId,
      command,
      nonce: challenge.nonce,
      payloadHash: await sha256Hex(digest),
    });
    return await this.signed(signer, challenge.nonce, message, digest);
  }

  /**
   * The payload of `card.pr.merge` for a host that binds a merge (#3453): the pull request and head commit
   * read now, and the device's proof over them when a device is enrolled. A host from before the feature
   * gets the plain payload. `declined`: the person said no in the system's dialog.
   */
  async mergePayload(
    hostId: string,
    cardId: string,
    method: "merge" | "squash",
  ): Promise<MergePayload> {
    const plain: MergeBody = { cardId, method, confirm: true };
    if (!this.supported(hostId, FEATURE_APPROVAL_COMMAND))
      return { kind: "payload", payload: plain };
    const result = await this.core.request(hostId, "card.pr.head", { cardId });
    if (!result.ok) throw new Error(this.refused(result));
    const bound: MergeBody = { ...plain, ...result.data };
    const proof = await this.proveCommand(hostId, "card.pr.merge", { ...bound });
    if (proof.kind === "declined") return proof;
    return {
      kind: "payload",
      payload: proof.kind === "proof" ? { ...bound, proof: proof.proof } : bound,
    };
  }

  /**
   * The payload that turns bypass on (#3507), with the device's proof over it when the host checks it and has
   * a device enrolled; a host from before the feature gets the plain payload. Turning it off is open and has
   * no payload here. `declined`: the person said no in the system's dialog.
   */
  async bypassPayload(hostId: string): Promise<BypassPayload> {
    const plain: BypassBody = { allow: true, confirm: true };
    const proof = await this.proveCommand(hostId, "host.bypass", { ...plain });
    if (proof.kind === "declined") return proof;
    return {
      kind: "payload",
      payload: proof.kind === "proof" ? { ...plain, proof: proof.proof } : plain,
    };
  }

  /**
   * The payload that adds the allowed folder `path` (#3507), with the device's proof over it when the host
   * checks it and has a device enrolled; a host from before the feature gets the plain payload. The host
   * stores the folder `path` resolves to and refuses a proof for another one, so `path` is the folder to show.
   * `declined`: the person said no in the system's dialog.
   */
  async rootsPayload(hostId: string, path: string): Promise<RootsPayload> {
    const plain = { path, confirm: true } as const;
    const proof = await this.proveCommand(hostId, "roots.add", { ...plain });
    if (proof.kind === "declined") return proof;
    return {
      kind: "payload",
      payload: proof.kind === "proof" ? { ...plain, proof: proof.proof } : plain,
    };
  }

  /**
   * The payload that writes a project's Claude Code setup (#3507), with the device's proof over the whole
   * request when the host checks it and has a device enrolled; a host from before the feature gets the plain
   * payload. `declined`: the person said no in the system's dialog.
   */
  async harnessPayload(hostId: string, body: HarnessBody): Promise<HarnessPayload> {
    const proof = await this.proveCommand(hostId, "project.harness.apply", { ...body });
    if (proof.kind === "declined") return proof;
    return {
      kind: "payload",
      payload: proof.kind === "proof" ? { ...body, proof: proof.proof } : body,
    };
  }

  /**
   * The payload that trusts `path`, signed by the device when the host checks it and a device is enrolled
   * (#3453). `path` is the folder the host reports for the project, which is the folder it will trust.
   * `declined`: the person said no in the system's dialog.
   */
  async trustPayload(hostId: string, path: string): Promise<TrustPayload> {
    const plain = { path, trusted: true };
    const proof = await this.proveCommand(hostId, "project.trust.set", plain);
    if (proof.kind === "declined") return proof;
    return {
      kind: "payload",
      payload: proof.kind === "proof" ? { ...plain, proof: proof.proof } : plain,
    };
  }

  /**
   * The payload that resumes the automatic approver of a session, signed by the device when the host checks
   * it and a device is enrolled (#3453). `declined`: the person said no in the system's dialog.
   */
  async resumePayload(hostId: string, sessionKey: string): Promise<ResumePayload> {
    const plain = { sessionKey, confirm: true };
    const proof = await this.proveCommand(hostId, "autoapprove.resume", plain);
    if (proof.kind === "declined") return proof;
    return {
      kind: "payload",
      payload: proof.kind === "proof" ? { ...plain, proof: proof.proof } : plain,
    };
  }

  /**
   * This device's key for a host that checks proofs for `feature` and has a device enrolled, or null
   * when nothing needs proving (no key port, a host that does not check, protection off). It throws,
   * with the person's text, when the host asks for a proof this device has no key for.
   */
  private async signer(hostId: string, feature: string): Promise<Signer | null> {
    const keys = this.core.keys();
    if (!keys || !this.supported(hostId, feature)) return null;
    const list = await this.ask(hostId, "approval.list", {});
    if (list.protectionOff) return null;
    const daemonId = this.daemonOf(hostId);
    const local = await keys.get(daemonId);
    if (!local || !list.keys.some((key) => key.keyId === local.keyId)) {
      throw new Error(this.core.t()("approvalDevices.noKeyHere"));
    }
    return { keys, daemonId, local };
  }

  /** The device signs `message` in its own dialog; a no from the person is `declined`, not an error. */
  private async signed(
    signer: Signer,
    nonce: string,
    message: string,
    payload?: string,
  ): Promise<ProofResult> {
    try {
      const signature = await signer.keys.sign(signer.daemonId, message, this.core.lang(), payload);
      return { kind: "proof", proof: { keyId: signer.local.keyId, nonce, signature } };
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
    throw new Error(this.refused(result));
  }

  /** The person's text for a refusal. */
  private refused(result: Extract<HostResult<unknown>, { ok: false }>): string {
    const why = {
      ...(result.reason ? { reason: result.reason } : {}),
      ...(result.params ? { params: result.params } : {}),
    };
    return refusalText(result.code, result.message, this.core.t(), why);
  }
}
