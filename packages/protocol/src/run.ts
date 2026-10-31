// Phase 24: the run environment's shared checks, so the daemon (which waits for a process to
// answer) and the app (which shows it) agree on which addresses a preview may open.

const LOOPBACK: ReadonlySet<string> = new Set(["127.0.0.1", "localhost"]);

/** The preview opens http(s) on this machine (127.0.0.1 or localhost), and nowhere else. */
export function isPreviewUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") && LOOPBACK.has(parsed.hostname)
    );
  } catch {
    return false;
  }
}
