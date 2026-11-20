/**
 * Issue #3515: what `flightdeckd project trust-state|stack|trust-inspect|harness-preview` say, as pure rules
 * over the daemon's answers. The daemon calls and the exit codes stay in `projects/project-cli.ts`.
 */
import type {
  HarnessPreview,
  HarnessStack,
  ProjectLoad,
  ProjectTrustStates,
} from "@flightdeck/protocol";

/** The parts a harness preview may name: the protocol's own list. */
export type HarnessPart = "claudeMd" | "hooks" | "skills" | "agents" | "permissions";

/** What the person typed for `project <verb>`, as `runProjectCli` takes it. `--json` prints the daemon's own answer. */
interface Printed {
  json?: boolean;
}
export type ProjectCliArgs =
  | (Printed & { action: "trust-state"; paths: string[] })
  | (Printed & { action: "stack"; path: string })
  | (Printed & { action: "trust-inspect"; path: string })
  | (Printed & {
      action: "harness-preview";
      path: string;
      parts: HarnessPart[];
      template?: string;
    });

export const trustLines = (_answer: ProjectTrustStates): string[] => [];
export const stackLines = (_answer: HarnessStack): string[] => [];
export const inspectLines = (_answer: ProjectLoad): string[] => [];
export const previewLines = (_answer: HarnessPreview): string[] => [];
