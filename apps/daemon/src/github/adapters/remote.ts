/** Issue #1612: where a project's GitHub repository is, read from its `origin` remote in any of its forms. */
import { stripRemote } from "../../central/project-key.ts";

/** `owner/repo` of a GitHub remote (`github.com` or an enterprise `github.*` host); else null. */
export function githubCoords(url: string): string | null {
  const [host = "", owner, repo, ...rest] = stripRemote(url).split("/");
  return host.includes("github") && owner && repo && rest.length === 0 ? `${owner}/${repo}` : null;
}
