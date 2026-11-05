import type { T } from "@/i18n/index";

/**
 * Why an action that needs the host cannot run now, by the host's state (issue #181): a refused
 * token asks to pair again, a first connection says it is on its way, an old daemon asks to be
 * updated, and anything else says the host is offline.
 */
export function hostDownReason(status: string, host: string, t: T): string {
  if (status === "unauthorized") return t("hostOffline.unauthorized");
  if (status === "connecting") return t("hostPage.needsConnection", { host });
  if (status === "incompatible") return t("hostPage.needsUpdate", { host });
  return t("hostPage.needsOnline", { host });
}
