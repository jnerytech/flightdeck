import type { TelemetryItem } from "@flightdeck/protocol";
import type { T } from "@/i18n/index.ts";

/** Who answered a permission, in words. */
function by(source: string | null, t: T): string {
  if (source === "config") return t("telemetry.byConfig");
  if (source === "hook") return t("telemetry.byHook");
  if (source?.startsWith("user_")) return t("telemetry.byYou");
  return t("telemetry.byOther");
}

/** What a step says, without its time. */
export function label(item: TelemetryItem, t: T): string {
  switch (item.kind) {
    case "tool":
      return item.toolName ?? "";
    case "permission":
      return t("telemetry.permission", {
        tool: item.toolName ?? "",
        decision: t(item.decision === "reject" ? "telemetry.denied" : "telemetry.allowed"),
        by: by(item.source, t),
      }).trim();
    case "api":
      return t("telemetry.api");
    case "error":
      return item.error
        ? t("telemetry.apiError", { status: item.error })
        : t("telemetry.apiErrorPlain");
  }
}
