import {
  FEATURE_APPROVAL_BYPASS,
  FEATURE_APPROVAL_COMMAND,
  FEATURE_APPROVAL_HARNESS,
  FEATURE_APPROVAL_MARKETPLACE,
  FEATURE_APPROVAL_PLUGINS,
  FEATURE_APPROVAL_PROOF,
  FEATURE_APPROVAL_RESUME,
  FEATURE_APPROVAL_ROOTS,
  FEATURE_APPROVAL_SNIPPETS,
  FEATURE_APPROVAL_TRUST,
} from "@flightdeck/protocol";
import { hasFeature } from "../../lib/version.ts";

/** A command a host from before its proof does not guard: the devices panel says so for each. */
export type UncheckedCommand =
  | "merge"
  | "trust"
  | "bypass"
  | "resume"
  | "roots"
  | "harness"
  | "plugins"
  | "marketplace"
  | "snippets";

/**
 * The commands whose proof the host does not check: it is from before they were guarded (#3453), so they ask
 * for no device. A host the app has no features for is not said to be one.
 */
export function uncheckedCommandsOf(features: readonly string[] | undefined): UncheckedCommand[] {
  if (features === undefined || !hasFeature(features, FEATURE_APPROVAL_PROOF, false)) return [];
  const unchecked: UncheckedCommand[] = [];
  if (!hasFeature(features, FEATURE_APPROVAL_COMMAND, false)) unchecked.push("merge");
  if (!hasFeature(features, FEATURE_APPROVAL_TRUST, false)) unchecked.push("trust");
  if (!hasFeature(features, FEATURE_APPROVAL_BYPASS, false)) unchecked.push("bypass");
  if (!hasFeature(features, FEATURE_APPROVAL_RESUME, false)) unchecked.push("resume");
  if (!hasFeature(features, FEATURE_APPROVAL_ROOTS, false)) unchecked.push("roots");
  if (!hasFeature(features, FEATURE_APPROVAL_HARNESS, false)) unchecked.push("harness");
  if (!hasFeature(features, FEATURE_APPROVAL_PLUGINS, false)) unchecked.push("plugins");
  if (!hasFeature(features, FEATURE_APPROVAL_MARKETPLACE, false)) unchecked.push("marketplace");
  // Only a host that keeps snippets has a trust to guard (#3647).
  if (
    hasFeature(features, "snippets", false) &&
    !hasFeature(features, FEATURE_APPROVAL_SNIPPETS, false)
  )
    unchecked.push("snippets");
  return unchecked;
}
