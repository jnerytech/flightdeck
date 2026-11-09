import type { CommandResult } from "./command.ts";
import type { Rev } from "./ref-arg.ts";

/** Issue #1405: the most files one overlap lists. */
export const MAX_SHARED_FILES = 20;

/** `git` in a folder: the radar's only effect, injected so a test counts the calls. */
export type RadarGit = (cwd: string, ...args: string[]) => Promise<CommandResult>;

/** A card the radar watches: its worktree and what it was cut from. */
export interface RadarCard {
  id: string;
  projectId: string;
  worktree: string;
  base: Rev;
  /** Cards of one group edit the same files on purpose (an arena's variants): never flagged together. */
  group: string;
}

/** Another card that changes some of the same files. */
export interface Overlap {
  cardId: string;
  files: string[];
}

/** Which cards of a project edit the same files, from what each one changed (issue #1405). */
export class ConflictRadar {
  constructor(private readonly git: RadarGit) {}

  /** Reads the card's changed files; returns the cards whose overlaps changed, the card included. */
  async update(_card: RadarCard): Promise<string[]> {
    return [];
  }

  /** The card left the board or lost its worktree; returns the cards that were flagged with it. */
  remove(_cardId: string): string[] {
    return [];
  }

  overlaps(_cardId: string): Overlap[] {
    return [];
  }
}
