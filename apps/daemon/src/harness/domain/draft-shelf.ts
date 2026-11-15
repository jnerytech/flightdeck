import { resolve } from "node:path";
import { samePath } from "../../kernel/index.ts";

/** The only file a draft is made for. */
export const FILE = "CLAUDE.md";
/** How long a draft is held, and how many: a draft is read and applied in one sitting. */
const TTL_MS = 30 * 60 * 1000;
const MAX_HELD = 16;

/** The key a draft is held under: its project and its digest. */
const keyOf = (root: string, digest: string): string => `${resolve(root)}\0${digest}`;

interface Held {
  root: string;
  file: string;
  content: string;
  at: number;
}

/** The drafts the host holds, by project and digest, for a while. */
export class DraftShelf {
  /** By project and digest: two projects may well be drafted the same text. */
  private readonly kept = new Map<string, Held>();

  constructor(private readonly now: () => number) {}

  /** Holds `content` for the project at `root` under its digest. */
  keep(root: string, digest: string, content: string): void {
    const key = keyOf(root, digest);
    this.kept.delete(key);
    this.kept.set(key, { root, file: FILE, content, at: this.now() });
    // The oldest go first: a Map keeps the order things were set in.
    while (this.kept.size > MAX_HELD) {
      const oldest = this.kept.keys().next().value as string;
      this.kept.delete(oldest);
    }
  }

  /** The draft of `file` for the project at `root` with this digest, while held; else null. */
  held(root: string, file: string, digest: string): string | null {
    // Only CLAUDE.md is ever drafted: a held text is never another file's.
    if (file !== FILE) return null;
    const key = keyOf(root, digest);
    const found = this.kept.get(key);
    if (!found || !samePath(found.root, root) || found.file !== file) return null;
    if (this.now() - found.at > TTL_MS) {
      this.kept.delete(key);
      return null;
    }
    return found.content;
  }
}
