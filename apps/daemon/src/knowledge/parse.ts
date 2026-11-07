import type { KnowledgeStatus, KnowledgeType } from "@flightdeck/protocol";

/** What one library document says about itself (issue #76). */
export interface ParsedKnowledge {
  title: string;
  type: KnowledgeType | null;
  status: KnowledgeStatus | "unclassified";
  supersedes: string | null;
  /** Codes of what is wrong with it: shown in the list, never a crash. */
  problems: string[];
}

export function parseKnowledge(_path: string, _text: string): ParsedKnowledge {
  return { title: "", type: null, status: "unclassified", supersedes: null, problems: [] };
}
