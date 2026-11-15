// The Agent setup context, the library of project documents: statuses, kinds and what a session is given of them (issue #1589: moved from agent-setup.ts).
import { z } from "zod";

/** Issue #76: a project's library of PRDs, RFCs, ADRs and specs, each with a lifecycle status. */
export const KnowledgeStatus = z.enum(["valid", "transitional", "obsolete"]);
export type KnowledgeStatus = z.infer<typeof KnowledgeStatus>;

export const KnowledgeType = z.enum(["prd", "rfc", "adr", "spec"]);

/** The kinds of document a template exists for (issue #1039). */
/** The longest body `knowledge.create` takes, in characters. */
export const KNOWLEDGE_BODY_MAX = 100_000;

export const KnowledgeKind = z.enum(["adr", "rfc", "prd"]);
export type KnowledgeKind = z.infer<typeof KnowledgeKind>;

export type KnowledgeType = z.infer<typeof KnowledgeType>;

export interface KnowledgeEntry {
  /** Relative to the project, with `/`. */
  path: string;
  title: string;
  type: KnowledgeType | null;
  /** `unclassified`: no status in its front matter, so agents are not given it. */
  status: KnowledgeStatus | "unclassified";
  /** The document this one replaces, as a project path. */
  supersedes: string | null;
  bytes: number;
  /** ISO time of the last change. */
  changedAt: string;
  /** What is wrong with the document itself, as codes (`status_unknown`, `supersedes_missing`, ...). */
  problems: string[];
  /** A valid document that points at an obsolete one: `references_obsolete:<path>`. */
  warnings: string[];
  /** What the list read of the file (its size and start); `knowledge.setStatus` writes only if it still holds. */
  hash: string;
}

export interface KnowledgeListResult {
  entries: KnowledgeEntry[];
  /** More documents than the list holds. */
  truncated: boolean;
}

/** Whether sessions in a project are given the library's index, and why not. */
export interface KnowledgeFeedState {
  /** Not switched off: the project, or a folder above it, is not in the host's `knowledge.feedOff`. */
  on: boolean;
  /** The project is trusted. An untrusted project is not given the index, on or off. */
  trusted: boolean;
  /** The folder in `knowledge.feedOff` that switches it off; the project itself, or one above it. */
  offBy: string | null;
  /** `offBy` is the project itself (under any name of it), so the project's own switch can turn it on. */
  own: boolean;
}

/** What a session is given of the library: Markdown for its system prompt, empty when it is not given any. */
export interface KnowledgeIndexResult {
  text: string;
  /** Documents named in the text. */
  fed: number;
  /** Documents that qualify were left out to stay under the cap. */
  truncated: boolean;
}
