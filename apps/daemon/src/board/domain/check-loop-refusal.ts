import type { PermissionMode } from "@flightdeck/protocol";

/** Why the switch stays off. */
type CheckLoopRefusal =
  | "check_loop_no_checks"
  | "check_loop_untrusted"
  | "check_loop_mode"
  | "check_loop_confirm";

/** The person-facing reason for each refusal. */
export const CHECK_LOOP_WHY: Record<CheckLoopRefusal, string> = {
  check_loop_no_checks: "the project has no checks to run",
  check_loop_untrusted: "the project is not trusted",
  check_loop_mode: "in plan mode the session cannot fix anything",
  check_loop_confirm: "outside bypassPermissions the person confirms first",
};

/**
 * Null when the switch may turn on, else why not, in this order: checks to run, a trusted
 * project, a mode that can edit, and a confirmation outside `bypassPermissions`.
 */
export function checkLoopRefusal(input: {
  checks: readonly string[];
  trusted: boolean;
  mode: PermissionMode;
  confirm: boolean;
}): CheckLoopRefusal | null {
  if (input.checks.length === 0) return "check_loop_no_checks";
  if (!input.trusted) return "check_loop_untrusted";
  if (input.mode === "plan") return "check_loop_mode";
  if (input.mode !== "bypassPermissions" && !input.confirm) return "check_loop_confirm";
  return null;
}
