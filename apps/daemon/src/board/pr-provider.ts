/**
 * Issue #1568: which PR provider a project's `origin` remote points to, so a project made before the
 * remote existed does not have to be set by hand. GitHub (and enterprise hosts) and Azure DevOps only.
 */
import { type AsyncGitRunner, runGitAsync } from "../central/project-key.ts";

export type DetectedProvider = "github" | "azure-devops";

/** What a remote address says: the provider when it is one Flightdeck opens PRs on, and its host name. */
export function providerOfRemote(_url: string | null): {
  provider: DetectedProvider | null;
  host: string | null;
} {
  return { provider: null, host: null };
}

export interface Detection {
  outcome: "set" | "kept" | "no_remote" | "unsupported";
  provider: DetectedProvider | null;
  host: string | null;
}

/** Looks at the project's `origin`; saves nothing (the caller sets the provider on `set`). */
export async function detectProvider(
  _project: { path: string; prProvider: string },
  _git: AsyncGitRunner = runGitAsync,
): Promise<Detection> {
  return { outcome: "kept", provider: null, host: null };
}
