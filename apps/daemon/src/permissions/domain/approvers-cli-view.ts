/**
 * Issue #3476: what `flightdeckd approvers watch` prints. The list of devices and each change are
 * lines a person reads; with `--json` each is one JSON object (a change is one line, for a script).
 * A device's key, a nonce and a code are never in them: the daemon does not send those.
 */
import type { ApprovalEnrolled, ApprovalKeyInfo, ApprovalRevoked } from "@flightdeck/protocol";

export interface ApproversCliArgs {
  /** `--follow`: keep the connection open and print each device enrolled or revoked until Ctrl-C. */
  follow?: boolean;
  json?: boolean;
}

/** What `approval.watch` pushes. */
export type ApprovalChangeFrame = ApprovalEnrolled | ApprovalRevoked;

/** The lines of `approvers watch` without `--follow`: the devices that can approve, or the way protection is off. */
export function deviceLines(list: { keys: ApprovalKeyInfo[] }): string[] {
  if (list.keys.length === 0) return ["no device enrolled: protection is off"];
  return list.keys.map((k) => `${k.keyId}  ${k.name}  ${k.client}  ${k.address}  ${k.enrolledAt}`);
}

/** The line `--follow` prints for a change. */
export function changeLine(change: ApprovalChangeFrame): string {
  if (change.type === "approval.revoked") return `revoked  ${change.keyId}`;
  const { keyId, name, client, address, enrolledAt } = change;
  return `enrolled  ${keyId}  ${name}  ${client}  ${address}  ${enrolledAt}`;
}

/** The change as `--follow --json` prints it: one object with the event's own fields, whatever else the frame carried. */
export function changeJson(change: ApprovalChangeFrame): string {
  if (change.type === "approval.revoked")
    return JSON.stringify({ type: change.type, keyId: change.keyId });
  const { type, keyId, name, client, address, enrolledAt } = change;
  return JSON.stringify({ type, keyId, name, client, address, enrolledAt });
}
