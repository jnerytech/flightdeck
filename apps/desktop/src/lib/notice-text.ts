import { translateError } from "../i18n/errors";
import type { T } from "../i18n/index";

/** What a card or run says about a problem: the refusal's reason in its language, else its text. */
export function reasonText(
  t: T,
  text: string,
  reason?: string | null,
  params?: Record<string, string | number> | null,
): string {
  if (!reason) return text;
  return translateError("", text, t, { reason, ...(params ? { params } : {}) }).title;
}
