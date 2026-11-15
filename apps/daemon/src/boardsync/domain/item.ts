import { TRUSTED_ASSOCIATIONS } from "../../github/index.ts";
import type { ExternalItem } from "./provider.ts";

/** One item of a GitHub Project (v2) as the GraphQL answer carries it. */
export interface GhNode {
  id: string;
  isArchived: boolean;
  updatedAt: string;
  fieldValueByName: { name: string } | null;
  content: {
    __typename: string;
    number?: number;
    title: string;
    body: string | null;
    url?: string;
    repository?: { nameWithOwner: string };
    author?: { login?: string } | null;
    authorAssociation?: string;
  } | null;
}

/**
 * What the sync keeps of an item. `external` marks a card whose text comes from someone the host
 * does not trust: neither `me` nor a trusted association (#1601).
 */
export function toItem(raw: GhNode, me: string): ExternalItem {
  const content = raw.content;
  const base = {
    id: raw.id,
    status: raw.fieldValueByName?.name ?? null,
    updatedAt: raw.updatedAt,
    archived: raw.isArchived,
  };
  if (!content) return { ...base, url: "", title: "", body: "", content: null };
  if (content.__typename === "DraftIssue") {
    return {
      ...base,
      url: "",
      title: content.title,
      body: content.body ?? "",
      content: { kind: "draft" },
    };
  }
  const author = (content.author?.login ?? "").toLowerCase();
  const external =
    author !== me && !TRUSTED_ASSOCIATIONS.has((content.authorAssociation ?? "").toUpperCase());
  return {
    ...base,
    url: content.url ?? "",
    title: content.title,
    body: content.body ?? "",
    content: {
      kind: content.__typename === "PullRequest" ? "pull_request" : "issue",
      ref: `github:${content.repository?.nameWithOwner ?? ""}#${content.number ?? ""}`,
      external,
    },
  };
}
