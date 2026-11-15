import type { T } from "@/i18n/index";

/** "flightdeckd 0.36.0", and the mismatch in words when it is not the app's; null before it is known. */
export function hostVersionText(
  t: T,
  daemon: string | null | undefined,
  app: string,
): string | null {
  if (!daemon) return null;
  const line = t("hostPage.daemon", { version: daemon });
  return daemon === app ? line : `${line} · ${t("hostPage.differs")}`;
}
