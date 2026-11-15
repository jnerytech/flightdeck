/**
 * Issue #1568: which PR provider a project's `origin` remote points to, so a project made before the
 * remote existed does not have to be set by hand. GitHub (and enterprise hosts) and Azure DevOps only.
 */
import { type AsyncGitRunner, runGitAsync } from "../central/index.ts";
import { type DetectedProvider, providerOfRemote } from "./domain/pr-provider-remote.ts";

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
