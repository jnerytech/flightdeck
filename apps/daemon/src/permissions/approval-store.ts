/** The device keys that may approve a high-risk request, the daemon's id and the enrollment window (#3439). */
import type { Database } from "bun:sqlite";

export interface StoredKey {
  keyId: string;
  publicKey: string;
  name: string;
  client: string;
  address: string;
  enrolledAt: string;
}

export interface EnrollWindow {
  until: Date;
  codeHash: string;
  failed: number;
}

interface KeyRow {
  key_id: string;
  public_key: string;
  name: string;
  client: string;
  address: string;
  enrolled_at: string;
}

export class ApprovalStore {
  constructor(
    private readonly db: Database,
    private readonly newId: () => string,
  ) {}

  /** The id of this daemon, made once at first use and kept for good: `reset` never changes it. */
  daemonId(): string {
    this.db
      .query("INSERT OR IGNORE INTO approval_meta (key, value) VALUES ('daemon_id', ?)")
      .run(this.newId());
    return this.meta("daemon_id") ?? "";
  }

  keys(): StoredKey[] {
    const rows = this.db
      .query("SELECT * FROM approval_keys ORDER BY enrolled_at, key_id")
      .all() as KeyRow[];
    return rows.map((row) => ({
      keyId: row.key_id,
      publicKey: row.public_key,
      name: row.name,
      client: row.client,
      address: row.address,
      enrolledAt: row.enrolled_at,
    }));
  }

  add(key: StoredKey): void {
    this.db
      .query(
        "INSERT OR IGNORE INTO approval_keys (key_id, public_key, name, client, address, enrolled_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(key.keyId, key.publicKey, key.name, key.client, key.address, key.enrolledAt);
  }

  remove(keyId: string): void {
    this.db.query("DELETE FROM approval_keys WHERE key_id = ?").run(keyId);
  }

  /** The open window, or null when none was opened or it was closed. Written only by the host terminal's CLI. */
  window(): EnrollWindow | null {
    const until = this.meta("window_until");
    const codeHash = this.meta("code_hash");
    if (!until || !codeHash) return null;
    return { until: new Date(until), codeHash, failed: Number(this.meta("failed_attempts") ?? 0) };
  }

  openWindow(codeHash: string, until: Date): void {
    this.setMeta("window_until", until.toISOString());
    this.setMeta("code_hash", codeHash);
    this.setMeta("failed_attempts", "0");
  }

  /** A wrong code was tried: how many so far in this window. */
  fail(): number {
    const failed = Number(this.meta("failed_attempts") ?? 0) + 1;
    this.setMeta("failed_attempts", String(failed));
    return failed;
  }

  closeWindow(): void {
    this.db
      .query(
        "DELETE FROM approval_meta WHERE key IN ('window_until', 'code_hash', 'failed_attempts')",
      )
      .run();
  }

  /** Removes every key and closes the window; the daemon id stays. Returns how many keys went. */
  reset(): number {
    const removed = this.keys().length;
    this.db.query("DELETE FROM approval_keys").run();
    this.closeWindow();
    return removed;
  }

  private meta(key: string): string | undefined {
    const row = this.db.query("SELECT value FROM approval_meta WHERE key = ?").get(key) as {
      value: string;
    } | null;
    return row?.value;
  }

  private setMeta(key: string, value: string): void {
    this.db
      .query(
        "INSERT INTO approval_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(key, value);
  }
}
