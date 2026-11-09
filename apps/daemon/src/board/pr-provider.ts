/**
 * Issue #1568: which PR provider a project's `origin` remote points to, so a project made before the
 * remote existed does not have to be set by hand. GitHub (and enterprise hosts) and Azure DevOps only.
 */
import { type AsyncGitRunner, runGitAsync, stripRemote } from "../central/project-key.ts";
import { azureCoords } from "../issues/remote.ts";

export type DetectedProvider = "github" | "azure-devops";

/**
 * Only a bare host name leaves this module. An address is whatever someone typed: a password with an
 * `@` or a `/` in it, a port that is a word or a query can leave a secret in what looks like the host,
 * so anything that is not letters, digits, hyphens and dots between labels gives nothing. A real
 * remote is `host/path`: a bare word is not one.
 */
const HOST_NAME = /^(?=.{1,253}$)[a-z0-9-]+(\.[a-z0-9-]+)*$/;
function hostOf(stripped: string): string | null {
  if (!stripped.includes("/")) return null;
  const lower = (stripped.split("/")[0] ?? "").toLowerCase();
  return HOST_NAME.test(lower) ? lower : null;
}

/** The hosts GitHub itself runs: a name that only has "github" in it is not one (an enterprise server is set by hand). */
const isGithubHost = (host: string | null) =>
  host === "github.com" || host === "ssh.github.com" || host?.endsWith(".ghe.com") === true;

/** The hosts Azure DevOps runs on, as the validated host name says (an encoded slash cannot pass for a dot). */
const isAzureHost = (host: string | null) =>
  host === "dev.azure.com" ||
  host === "ssh.dev.azure.com" ||
  host?.endsWith(".visualstudio.com") === true;

/** What a remote address says: the provider when it is one Flightdeck opens PRs on, and its host name. */
export function providerOfRemote(url: string | null): {
  provider: DetectedProvider | null;
  host: string | null;
} {
  if (url === null || url.trim() === "") return { provider: null, host: null };
  const stripped = stripRemote(url);
  const host = hostOf(stripped);
  const [, owner, repo, ...rest] = stripped.split("/");
  if (isGithubHost(host) && owner && repo && rest.length === 0) return { provider: "github", host };
  if (isAzureHost(host) && azureCoords(url)) return { provider: "azure-devops", host };
  return { provider: null, host };
}

export interface Detection {
  outcome: "set" | "kept" | "no_remote" | "unsupported" | "unreadable";
  provider: DetectedProvider | null;
  host: string | null;
}

/** The answer of a promise, or an error when it takes longer than `ms`. */
function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("git took too long")), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/** Looks at the project's `origin`; saves nothing (the caller sets the provider on `set`). */
export async function detectProvider(
  project: { path: string; prProvider: string },
  git: AsyncGitRunner = runGitAsync,
  timeoutMs = 5000,
): Promise<Detection> {
  if (project.prProvider !== "none") return { outcome: "kept", provider: null, host: null };
  let result: { code: number; stdout: string };
  try {
    // git-arg: a fixed command; `-C` takes the stored project path as its value
    result = await within(
      git(["-C", project.path, "config", "--get", "remote.origin.url"]),
      timeoutMs,
    );
  } catch {
    return { outcome: "unreadable", provider: null, host: null };
  }
  // Exit 1 is git's own answer for a key that is not there; anything else failed to read the repository.
  if (result.code !== 0 && result.code !== 1)
    return { outcome: "unreadable", provider: null, host: null };
  const url = result.code === 0 ? result.stdout.trim() : "";
  if (url === "") return { outcome: "no_remote", provider: null, host: null };
  const { provider, host } = providerOfRemote(url);
  if (provider) return { outcome: "set", provider, host: null };
  return { outcome: "unsupported", provider: null, host };
}
