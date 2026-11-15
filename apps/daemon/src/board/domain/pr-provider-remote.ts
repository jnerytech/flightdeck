/**
 * Issue #1568: which PR provider a project's `origin` remote points to. Pure over the remote address:
 * the git call that reads it stays in `board/pr-provider.ts`.
 */
import { stripRemote } from "../../central/index.ts";
import { azureCoords } from "../../issues/index.ts";

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
