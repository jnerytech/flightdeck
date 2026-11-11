import type { AutoApproval, PermissionResolution } from "@flightdeck/protocol";
import type { Key, T } from "@/i18n/index";

/** The answers a request already carries (the tool's input after it was answered), if any. */
export function savedAnswers(input: Record<string, unknown>): Record<string, string> | null {
  const saved = input.answers;
  return saved && typeof saved === "object" ? (saved as Record<string, string>) : null;
}

/** "Approved automatically (rule): reason": who decided, and why. */
export function autoLine(auto: AutoApproval, t: T): string {
  let by = t("approval.autoBy.rule");
  if (auto.by === "ai") {
    by = auto.model ? t("approval.autoBy.aiModel", { model: auto.model }) : t("approval.autoBy.ai");
  }
  return t("approval.autoApproved", { by, reason: auto.reason });
}

/** What the card says once the request is settled: the denial's reason, who approved it, or the decision. */
export function resolutionLine(
  resolution: { decision: PermissionResolution; message?: string; auto?: AutoApproval },
  t: T,
): string {
  if (resolution.decision === "deny" && resolution.message) {
    return t("approval.deniedWith", { message: resolution.message });
  }
  if (resolution.auto) return autoLine(resolution.auto, t);
  return t(`approval.resolved.${resolution.decision}` as Key);
}
