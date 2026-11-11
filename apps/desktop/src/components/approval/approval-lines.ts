import type { AutoApproval, PermissionResolution } from "@flightdeck/protocol";
import type { T } from "@/i18n/index";

/** The answers a request already carries (the tool's input after it was answered), if any. */
export function savedAnswers(_input: Record<string, unknown>): Record<string, string> | null {
  return {};
}

/** "Approved automatically (rule): reason": who decided, and why. */
export function autoLine(_auto: AutoApproval, _t: T): string {
  return "";
}

/** What the card says once the request is settled: the denial's reason, who approved it, or the decision. */
export function resolutionLine(
  _resolution: { decision: PermissionResolution; message?: string; auto?: AutoApproval },
  _t: T,
): string {
  return "";
}
