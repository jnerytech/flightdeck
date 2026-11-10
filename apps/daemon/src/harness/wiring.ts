import { join } from "node:path";
import type { Config } from "../config.ts";
import { featureOff } from "../errors.ts";
import { present } from "../present.ts";
import { type ApplyOptions, applyHarness } from "./apply.ts";
import { commitHarness } from "./commit.ts";
import { type DraftDeps, HarnessDrafts } from "./draft.ts";
import { type PreviewPart, previewHarness } from "./preview.ts";
import { detectStack } from "./stack.ts";
import { HarnessTemplates } from "./templates-store.ts";

/** What the harness side of the host is built from. */
export interface HarnessDeps {
  /** The host's runtime: only one that can run a one-shot drafts a CLAUDE.md. */
  runtime: Partial<Pick<DraftDeps, "complete">>;
  quota: DraftDeps["quota"];
  /** The host's scanner (the vault's values among them): nothing secret is held or shared. */
  scanner: DraftDeps["scanner"];
  /** The assistant's scratch folder, where the drafts' one-shot calls run. */
  cwd: string;
  config: Pick<Config, "dataDir" | "allowApiKey">;
}

/**
 * The project harness of the host (#75, issue #1593): the stack, preview, apply, draft, commit
 * and templates the server offers.
 */
export function createHarness({ runtime, quota, scanner, cwd, config }: HarnessDeps) {
  // Phase 40: the AI assistant on this host's claude (the fake runtime answers in the demo).
  // Issue #75, slice G1: CLAUDE.md drafts on this host's claude, held by digest until applied.
  const harnessDrafts = new HarnessDrafts({
    complete: (opts) =>
      runtime.complete ? runtime.complete(opts) : Promise.reject(featureOff("harnessDraft")),
    quota,
    scanner,
    cwd,
    allowApiKey: config.allowApiKey,
  });
  return {
    harnessStack: detectStack,
    harnessPreview: previewHarness,
    harnessApply: (
      path: string,
      parts: readonly PreviewPart[],
      digests: Readonly<Record<string, string>>,
      options: ApplyOptions,
    ) => applyHarness(path, parts, digests, { ...options, drafts: harnessDrafts }),
    // Only a runtime that can run a one-shot drafts: the feature is not offered otherwise.
    ...present({
      harnessDraft: runtime.complete && ((path: string) => harnessDrafts.draft(path)),
    }),
    harnessCommit: (path: string, digests: Readonly<Record<string, string>>) =>
      commitHarness(path, digests, { scanner }),
    harnessTemplates: new HarnessTemplates(join(config.dataDir, "harness-templates"), scanner),
  };
}
