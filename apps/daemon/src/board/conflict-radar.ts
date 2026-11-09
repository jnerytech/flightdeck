import { type CommandResult, gitLimitedFor } from "./command.ts";
import type { Rev } from "./ref-arg.ts";

/** Issue #1405: the most files one overlap lists. */
export const MAX_SHARED_FILES = 20;

/** `git` in a folder: the radar's only effect, injected so a test counts the calls. */
export type RadarGit = (cwd: string, ...args: string[]) => Promise<CommandResult>;

/** Issue #1405: the most peers one card lists, and the most files the radar keeps of a card. */
export const MAX_PEERS = 10;
export const MAX_FILES_PER_CARD = 2000;

type LimitedGit = (
  cwd: string,
  limit: number,
  args: string[],
  timeoutMs?: number,
) => Promise<CommandResult & { truncated: boolean }>;

/** The radar's git: no fsmonitor hook, output capped, and a time limit; a cut-off read is a failure. */
export function radarGit(
  _limit = 1024 * 1024,
  _timeoutMs = 10_000,
  _run: LimitedGit = gitLimitedFor,
): RadarGit {
  return async () => ({ code: 0, stdout: "", stderr: "" });
}

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

interface Entry {
  projectId: string;
  group: string;
  /** The HEAD `committed` was read at: the commits are read again only when it moves. */
  head: string;
  committed: string[];
  files: Set<string>;
}

const names = (result: CommandResult): string[] => result.stdout.split("\0").filter(Boolean);

/**
 * Which cards of a project edit the same files, from what each one changed (issue #1405). A card's
 * files are its commits since the base (read again only when its HEAD moves) and what it edits now.
 * An index from file to cards answers who shares a file without scanning the other cards.
 */
export class ConflictRadar {
  private readonly entries = new Map<string, Entry>();
  /** By project, then by file: the cards that change it. */
  private readonly index = new Map<string, Map<string, Set<string>>>();

  constructor(private readonly git: RadarGit) {}

  /** Reads the card's changed files; returns the card and the cards whose overlaps changed. */
  async update(card: RadarCard, _isCurrent: () => boolean = () => true): Promise<string[]> {
    const head = await this.git(card.worktree, "rev-parse", "HEAD");
    if (head.code !== 0) return [];
    const sha = head.stdout.trim();
    const before = this.entries.get(card.id);
    let committed = before?.head === sha ? before.committed : null;
    if (committed === null) {
      // git-arg: the base is a Rev checked by refArg; the trailing -- ends the revisions.
      const diff = await this.git(
        card.worktree,
        "diff",
        "--name-only",
        "-z",
        `${card.base}...HEAD`,
        "--",
      );
      if (diff.code !== 0) return [];
      committed = names(diff);
    }
    const tracked = await this.git(card.worktree, "diff", "--name-only", "-z", "HEAD", "--");
    const untracked = await this.git(
      card.worktree,
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
    );
    if (tracked.code !== 0 || untracked.code !== 0) return [];
    const files = new Set([...committed, ...names(tracked), ...names(untracked)]);
    if (before && sameFiles(before.files, files) && before.group === card.group) {
      before.head = sha;
      before.committed = committed;
      return [];
    }
    const affected = new Set<string>([card.id]);
    if (before) for (const peer of this.peersOf(card.id, before)) affected.add(peer);
    this.drop(card.id);
    const entry: Entry = {
      projectId: card.projectId,
      group: card.group,
      head: sha,
      committed,
      files,
    };
    this.entries.set(card.id, entry);
    const byFile = this.index.get(card.projectId) ?? new Map<string, Set<string>>();
    this.index.set(card.projectId, byFile);
    for (const file of files) {
      const cards = byFile.get(file) ?? new Set<string>();
      cards.add(card.id);
      byFile.set(file, cards);
    }
    for (const peer of this.peersOf(card.id, entry)) affected.add(peer);
    return [...affected];
  }

  /** The card left the board or lost its worktree; returns the cards that were flagged with it. */
  remove(cardId: string): string[] {
    const entry = this.entries.get(cardId);
    if (!entry) return [];
    const peers = [...this.peersOf(cardId, entry)];
    this.drop(cardId);
    return peers.sort();
  }

  /** The cards that share files with this one, with the files, in card order. */
  overlaps(cardId: string): Overlap[] {
    const entry = this.entries.get(cardId);
    const byFile = entry && this.index.get(entry.projectId);
    if (!entry || !byFile) return [];
    const shared = new Map<string, string[]>();
    for (const file of [...entry.files].sort()) {
      for (const peer of this.peersAt(byFile, file, cardId, entry.group)) {
        const list = shared.get(peer) ?? [];
        if (list.length < MAX_SHARED_FILES) list.push(file);
        shared.set(peer, list);
      }
    }
    return [...shared]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([peer, files]) => ({ cardId: peer, files }));
  }

  private peersOf(cardId: string, entry: Entry): Set<string> {
    const peers = new Set<string>();
    const byFile = this.index.get(entry.projectId);
    if (!byFile) return peers;
    for (const file of entry.files) {
      for (const peer of this.peersAt(byFile, file, cardId, entry.group)) peers.add(peer);
    }
    return peers;
  }

  private peersAt(
    byFile: Map<string, Set<string>>,
    file: string,
    cardId: string,
    group: string,
  ): string[] {
    return [...(byFile.get(file) ?? [])].filter(
      (peer) => peer !== cardId && this.entries.get(peer)?.group !== group,
    );
  }

  private drop(cardId: string): void {
    const entry = this.entries.get(cardId);
    if (!entry) return;
    this.entries.delete(cardId);
    const byFile = this.index.get(entry.projectId);
    if (!byFile) return;
    for (const file of entry.files) {
      const cards = byFile.get(file);
      cards?.delete(cardId);
      if (cards?.size === 0) byFile.delete(file);
    }
  }
}

function sameFiles(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const file of a) if (!b.has(file)) return false;
  return true;
}
