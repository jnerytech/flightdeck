import {
  type KnowledgeStatus,
  KnowledgeStatus as Statuses,
  KnowledgeType as Types,
} from "@flightdeck/protocol";
import { frontmatter } from "../agentcfg/files.ts";

/** What one library document says about itself (issue #76). */
export interface ParsedKnowledge {
  title: string;
  type: KnowledgeType | null;
  status: KnowledgeStatus | "unclassified";
  supersedes: string | null;
  /** Codes of what is wrong with it: shown in the list, never a crash. */
  problems: string[];
}

type KnowledgeType = (typeof Types.options)[number];

/** The type a folder implies, when the front matter does not say. */
const FOLDER_TYPES: ReadonlyArray<readonly [string, KnowledgeType]> = [
  ["adr", "adr"],
  ["decisions", "adr"],
  ["rfc", "rfc"],
  ["prd", "prd"],
  ["specs", "spec"],
];

/** `(issue #12)` or `(phase 7)` at the end of a heading: the number is the decision's, not its name. */
const SUFFIX = /\s*\((?:issue #\d+|phase \d+)\)\s*$/;

const folderType = (path: string): KnowledgeType | null => {
  const folder = path.split("/").at(-2) ?? "";
  return FOLDER_TYPES.find(([name]) => name === folder)?.[1] ?? null;
};

/** The first `# ` heading after the front matter, or the file name without `.md`. */
function titleOf(path: string, body: string): string {
  const heading = /^# +(.+?) *$/m.exec(body)?.[1];
  const cleaned = heading?.replace(SUFFIX, "").trim();
  return cleaned || (path.split("/").at(-1) ?? path).replace(/\.md$/i, "");
}

/** The front matter and the text after it; no front matter is `null` and the whole text. */
function split(text: string): {
  data: Record<string, unknown> | null;
  body: string;
  broken: boolean;
} {
  const plain = text.replace(/^﻿/, "");
  const block = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(plain);
  if (!block) return { data: null, body: plain, broken: false };
  const data = frontmatter(plain);
  return { data, body: plain.slice(block[0].length), broken: data === null };
}

export function parseKnowledge(path: string, text: string): ParsedKnowledge {
  const { data, body, broken } = split(text);
  const problems: string[] = [];
  if (broken) problems.push("frontmatter_invalid");
  const found = Statuses.safeParse(data?.status);
  if (data && "status" in data && !found.success) problems.push("status_unknown");
  const declared = Types.safeParse(data?.type);
  if (data && "type" in data && !declared.success) problems.push("type_unknown");
  const supersedes = data?.supersedes;
  if (data && "supersedes" in data && typeof supersedes !== "string") {
    problems.push("supersedes_invalid");
  }
  const title = typeof data?.title === "string" && data.title.trim() ? data.title.trim() : null;
  return {
    title: title ?? titleOf(path, body),
    type: declared.success ? declared.data : folderType(path),
    status: found.success ? found.data : "unclassified",
    supersedes: typeof supersedes === "string" ? supersedes : null,
    problems,
  };
}
