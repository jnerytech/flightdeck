import { resolve } from "node:path";
import type { KnowledgeFeedState } from "@flightdeck/protocol";
import { expandHome } from "../config.ts";
import { isInside, rootNames, samePath } from "../paths.ts";

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

/**
 * The folder of `off` that switches off a project: the first one that is, or holds, one of the
 * project's names (a folder is one place under its real name and the one it was given by).
 */
export async function offFolder(
  off: readonly string[],
  names: readonly string[],
): Promise<string | null> {
  for (const folder of off) {
    const places = await rootNames([folder]);
    if (places.some((place) => names.some((name) => isInside(place, name)))) return folder;
  }
  return null;
}

export function knowledgeSwitchFor(deps: KnowledgeSwitchDeps): KnowledgeSwitch {
  const state = async (path: string): Promise<KnowledgeFeedState> => {
    const { trusted, configRoot } = await deps.trust(path);
    // The checkout a worktree is read from counts too: a worktree can lie outside its project.
    const names = await rootNames(configRoot ? [path, configRoot] : [path]);
    const offBy = await offFolder(deps.off(), names);
    return { on: offBy === null, trusted, offBy, own: false };
  };
  const apply = async (path: string, enabled: boolean) => {
    if (!enabled) {
      if ((await state(path)).on) await deps.change((entries) => [...entries, path]);
    } else {
      const names = await rootNames([path]);
      // The entries that are this project under some name: its path, `~`, or a link to it.
      const ours = new Set<string>();
      for (const entry of deps.off()) {
        const places = await rootNames([entry]);
        if (places.some((place) => names.some((name) => samePath(place, name)))) ours.add(entry);
      }
      const named = (entry: string) => ours.has(resolve(expandHome(entry)));
      // Only the entries that name this project: a folder above it switches off other projects too.
      if (ours.size > 0) await deps.change((entries) => entries.filter((e) => !named(e)));
    }
    return await state(path);
  };
  // The config file is read, changed and written back: two at once would lose one.
  let queue: Promise<unknown> = Promise.resolve();
  return {
    state,
    set: (path, enabled) => {
      const next = queue.then(() => apply(path, enabled));
      queue = Promise.allSettled([next]);
      return next;
    },
  };
}
