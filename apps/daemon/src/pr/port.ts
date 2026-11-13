import type { ChecksState, PrState } from "@flightdeck/protocol";
import type { CommandResult } from "../kernel/index.ts";
import type { PrDetails } from "./pr-details.ts";

export interface PrStatus extends Partial<PrDetails> {
  state: PrState;
  checks: ChecksState | null;
  /** Phase 13: the names of the checks that failed, when the host says. */
  failed?: string[];
}

export interface CreatePr {
  cwd: string;
  base: string;
  head: string;
  title: string;
  body: string;
}

/** A review comment of a PR, read from the provider (phase 11); nothing is ever posted back. */
export interface PrComment {
  id: string;
  /** `null` for a review's summary, which is about the whole PR. */
  path: string | null;
  line: number | null;
  author: string;
  /** GitHub's `author_association` (OWNER, MEMBER, COLLABORATOR, CONTRIBUTOR, NONE…). */
  authorAssociation: string | null;
  /** Azure DevOps' identity of the author: `uniqueName`, else the id. */
  authorIdentity: string | null;
  body: string;
  resolved: boolean;
  kind: "inline" | "review";
}

/** The chosen PR comments as one message to the agent, like the inline review. */
export function prMessage(comments: readonly PrComment[]): string {
  return [
    "Comentários do PR:",
    ...comments.map((c, i) => {
      const line = c.line === null ? "" : " linha " + c.line;
      const where = c.path ? `\`${c.path}\`${line} (${c.author})` : `revisão de ${c.author}`;
      const body = c.body
        .replace(/\r?\n$/, "")
        .split(/\r?\n/)
        .map((line) => `   ${line}`)
        .join("\n");
      return `${i + 1}. ${where}:\n${body}`;
    }),
  ].join("\n");
}

/** One check of a PR: a build or a policy the host evaluates (phase 22). */
export interface PrCheck {
  name: string;
  state: "passing" | "failing" | "pending";
  /** A build can be read for its log; any other policy cannot be fixed by code. */
  kind: "build" | "policy";
  /** The host's id of the build behind the check, to fetch its log. */
  buildId: string | null;
}

/** What the PR watcher reads of a PR each round (phase 22). */
export interface PrHealth {
  checks: PrCheck[];
  /** The PR cannot be merged into its target as it is. */
  conflicts: boolean;
}

/** A PR host reached through its CLI, which must be installed and logged in on this host. */
export interface PrProvider {
  /** Opens the PR (or reuses the one already open for `head`) and returns its URL. */
  create(opts: CreatePr): Promise<string>;
  status(opts: { cwd: string; url: string }): Promise<PrStatus>;
  /** URL of the open PR for `head`, if any. */
  url(opts: { cwd: string; head: string }): Promise<string | null>;
  /** The PR's review comments and review summaries. */
  comments(opts: { cwd: string; url: string }): Promise<PrComment[]>;
  /** Phase 22: the PR's builds and policies, and whether it conflicts with its target. */
  health(opts: { cwd: string; url: string }): Promise<PrHealth>;
  /** Phase 22: the end of the log of what failed in a build, at most 16 KB. */
  buildLog(opts: { cwd: string; url: string; buildId: string }): Promise<string>;
  /** #1196: merges the open PR (a merge commit or a squash); a provider without it cannot. */
  merge?(opts: { cwd: string; url: string; method: "merge" | "squash" }): Promise<void>;
}

/** Starts a program that was found: runCommand, or a stand-in that starts nothing. */
export type CommandRunner = (cmd: string[], cwd: string, input?: string) => Promise<CommandResult>;
