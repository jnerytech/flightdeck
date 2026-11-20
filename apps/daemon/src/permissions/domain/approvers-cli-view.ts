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
export function deviceLines(_list: { keys: ApprovalKeyInfo[] }): string[] {
  return [];
}

/** The line `--follow` prints for a change. */
export function changeLine(_change: ApprovalChangeFrame): string {
  return "";
}

/** The change as `--follow --json` prints it: one object, the frame's own fields. */
export function changeJson(_change: ApprovalChangeFrame): string {
  return "";
}
