/** Where a project's issues live, read from its `origin` remote in any of its forms. */
import { stripRemote } from "../central/project-key.ts";

const decode = (text: string) => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};

/** `owner/repo` of a GitHub remote (`github.com` or an enterprise `github.*` host); else null. */
export function githubCoords(url: string): string | null {
  const [host = "", owner, repo, ...rest] = stripRemote(url).split("/");
  return host.includes("github") && owner && repo && rest.length === 0 ? `${owner}/${repo}` : null;
}

/** Organization and project of an Azure DevOps remote (https, ssh or the old visualstudio.com). */
export function azureCoords(url: string): { org: string; project: string } | null {
  const segments = stripRemote(url).split("/").map(decode);
  const [host = "", ...rest] = segments;
  if (host === "ssh.dev.azure.com") {
    const [version, org, project] = rest;
    return version === "v3" && org && project ? { org, project } : null;
  }
  if (host === "dev.azure.com") {
    const [org, project] = rest;
    return org && project ? { org, project } : null;
  }
  const old = /^(.+)\.visualstudio\.com$/.exec(host);
  const project = rest.find((part) => part !== "DefaultCollection");
  return old?.[1] && project ? { org: old[1], project } : null;
}
