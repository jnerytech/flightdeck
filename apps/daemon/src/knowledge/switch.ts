import type { KnowledgeFeedState } from "@flightdeck/protocol";

/**
 * Issue #76: the person's switch for the library's index, per project. It is a folder in the
 * host's `knowledge.feedOff`: the project itself, or one above it that switches off everything inside.
 */
export interface KnowledgeSwitchDeps {
  /** The folders of `knowledge.feedOff`, made absolute. */
  off(): readonly string[];
  /** Looks at the folder's git boundary, then says whether its own files may load and from where. */
  trust(path: string): Promise<{ trusted: boolean; configRoot?: string }>;
  /** Rewrites the entries of `knowledge.feedOff` in the config file, and nothing else in it. */
  change(update: (entries: string[]) => string[]): Promise<void>;
}

export interface KnowledgeSwitch {
  state(path: string): Promise<KnowledgeFeedState>;
  set(path: string, enabled: boolean): Promise<KnowledgeFeedState>;
}

export function knowledgeSwitchFor(_deps: KnowledgeSwitchDeps): KnowledgeSwitch {
  const state = async () => ({ on: false, trusted: false, offBy: null });
  return { state, set: state };
}
