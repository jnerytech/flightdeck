import { inSequence } from "@flightdeck/protocol";
import type { Vault } from "../../lib/vault.ts";

/** What the scan reads through the app's store: the vault, to learn its values. */
export interface VaultScanCore {
  vault: Pick<Vault, "list" | "value">;
}

/**
 * What the app's log and the screens must never write or show (#1596: a slice of the store): every
 * host's token and the vault's values, a copy kept in memory only, refreshed when the vault
 * changes, never saved or sent. The callers compare text against it; none of them gets it stored.
 */
export class VaultScanSlice {
  /**
   * Goes up each time `values` may give more (#827): what masks text already on screen, such as
   * the files search's matches, renders again through `subscribe`.
   */
  version = 0;
  private readonly tokens = new Set<string>();
  private pieces: string[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(private readonly core: VaultScanCore) {}

  /** What must never be written, read at each line: the hosts' tokens and the vault's values. */
  values(): string[] {
    return [...this.tokens, ...this.pieces];
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** A host's token, learned when the app tests or opens its connection. */
  rememberToken(token: string): void {
    this.tokens.add(token);
    this.changed();
  }

  /** Reads the vault's values again, after the list changed. */
  async refresh(): Promise<void> {
    try {
      this.pieces = await this.vaultValues();
      this.changed();
    } catch {
      // The log's cache is a convenience: a vault that cannot be read leaves the last one.
    }
  }

  /**
   * The vault's values, line by line and an env set's variable by variable, long enough to tell
   * apart from ordinary text (6+ characters), for a scan that runs in the app: they are compared
   * by the caller, never sent and never kept here (phase 18's history import).
   */
  async vaultValues(): Promise<string[]> {
    const pieces: string[] = [];
    await inSequence(this.core.vault.list(), async (secret) => {
      const value = await this.core.vault.value(secret.id);
      if (value === null) return;
      // A whole value can be long and many-lined: what a history line would carry is one line,
      // and of an env set, one variable's value.
      for (const line of value.split(/\r?\n/)) {
        const assigned = secret.type === "env" ? /^\s*[A-Za-z_]\w*\s*=(.*)$/.exec(line) : null;
        const piece = (assigned ? (assigned[1] as string) : line)
          .trim()
          .replace(/^(["'])(.*)\1$/, "$2");
        if (piece.length >= 6) pieces.push(piece);
      }
    });
    return pieces;
  }

  private changed(): void {
    this.version++;
    for (const listener of this.listeners) listener();
  }
}
