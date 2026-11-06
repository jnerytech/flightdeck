import type { T } from "@/i18n/index";
import type { Wand } from "./use-wand.ts";

/** The wand's button for a toolbar (issue #158). */
export function WandButton(_props: { wand: Wand; t: T }) {
  return null;
}

/** The wand's progress, failure and preview, under the field (issue #158). */
export function WandPanel(_props: { wand: Wand; t: T }) {
  return null;
}
