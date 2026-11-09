/**
 * Issue #1568: which PR provider a project's `origin` remote points to, so a project made before the
 * remote existed does not have to be set by hand. GitHub (and enterprise hosts) and Azure DevOps only.
 */
import { type AsyncGitRunner, runGitAsync, stripRemote } from "../central/project-key.ts";
import { azureCoords, githubCoords } from "../issues/remote.ts";

export type DetectedProvider = "github" | "azure-devops";

/**
 * Only a bare host name leaves this module. An address is whatever someone typed: a password with an
 * `@` or a `/` in it, a port that is a word or a query can leave a secret in what looks like the host,
 * so anything that is not letters, digits, hyphens and dots between labels gives nothing.
 */
const HOST_NAME = /^(?=.{1,253}$)([a-z0-9-]+\.)+[a-z0-9-]+$/;
function plainHost(part: string): string | null {
  const lower = part.toLowerCase();
  return HOST_NAME.test(lower) ? lower : null;
}

/** What a remote address says: the provider when it is one Flightdeck opens PRs on, and its host name. */
export function providerOfRemote(url: string | null): {
  provider: DetectedProvider | null;
  host: string | null;
} {
  if (url === null || url.trim() === "") return { provider: null, host: null };
  const host = plainHost(stripRemote(url).split("/")[0] ?? "");
  if (githubCoords(url)) return { provider: "github", host };
  if (azureCoords(url)) return { provider: "azure-devops", host };
  return { provider: null, host };
}

export interface Detection {
  outcome: "set" | "kept" | "no_remote" | "unsupported";
  provider: DetectedProvider | null;
  host: string | null;
}

/** The project's `origin` address, or null when it has none (or git cannot be run). */
async function originOf(path: string, git: AsyncGitRunner): Promise<string | null> {
  try {
    const result = await git(["-C", path, "config", "--get", "remote.origin.url"]);
    return result.code === 0 && result.stdout.trim() !== "" ? result.stdout.trim() : null;
  } catch {
    return null;
  }
}

/** Looks at the project's `origin`; saves nothing (the caller sets the provider on `set`). */
export async function detectProvider(
  project: { path: string; prProvider: string },
  git: AsyncGitRunner = runGitAsync,
): Promise<Detection> {
  if (project.prProvider !== "none") return { outcome: "kept", provider: null, host: null };
  const url = await originOf(project.path, git);
  if (url === null) return { outcome: "no_remote", provider: null, host: null };
  const { provider, host } = providerOfRemote(url);
  if (provider) return { outcome: "set", provider, host: null };
  return { outcome: "unsupported", provider: null, host };
}
