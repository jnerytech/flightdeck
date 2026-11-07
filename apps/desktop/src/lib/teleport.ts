/**
 * Issue #100, slice 3a: the app moves an idle session from one host to another. It asks the source
 * for a package, shows the person what moves (counts only: no text of the transcript or the code
 * reaches the summary), relays the package's parts chunk by chunk to the target, and has the target
 * import it. Whatever stops it (a no, a cancel, a refusal, a host that went) cleans both sides.
 */
import type {
  CommandPayload,
  CommandResults,
  CommandType,
  TeleportManifest,
} from "@flightdeck/protocol";

/** One host's command channel: a connection's `request`, injected so tests use fakes. */
export type TeleportRequest = <T extends CommandType>(
  type: T,
  payload: CommandPayload<T>,
) => Promise<CommandResults[T]>;

/** What the person sees before saying yes: counts and sizes, never a secret or its kind. */
export interface TeleportSummary {
  branch: string | null;
  /** Commits past the base on origin. */
  ahead: number;
  /** Files the working tree changes, new ones included. */
  changed: number;
  /** Bytes that travel, every part together. */
  bytes: number;
  /** Lines that look like secrets, in the transcript and the code together. */
  secretLines: number;
}

export interface TeleportRun {
  source: TeleportRequest;
  target: TeleportRequest;
  sessionId: string;
  /** The repository on the target, picked by the person. */
  repo: string;
  confirm(summary: TeleportSummary): Promise<boolean>;
  onProgress?(sent: number, total: number): void;
  signal?: AbortSignal;
}

export type TeleportOutcome =
  | { kind: "moved"; sessionId: string; worktree: string; branch: string }
  | { kind: "declined" }
  | { kind: "cancelled" };

export function teleportSummary(manifest: TeleportManifest): TeleportSummary {
  return {
    branch: manifest.git?.branch ?? null,
    ahead: manifest.git?.ahead ?? 0,
    changed: manifest.git?.changed ?? 0,
    bytes: manifest.parts.reduce((sum, part) => sum + part.size, 0),
    // The count only: the scanner's kinds stay on the hosts (and are not yet translated, #714).
    secretLines: manifest.secrets.lines,
  };
}

/** The move was cancelled: not an error, an outcome. */
class Cancelled extends Error {}

/** A clean-up step: a host that went meanwhile does not hide why the move stopped. */
const quietly = (work: Promise<unknown>) =>
  work.then(
    () => undefined,
    () => undefined,
  );

export async function teleportSession(run: TeleportRun): Promise<TeleportOutcome> {
  const { source, target } = run;
  const manifest = await source("teleport.prepare", { sessionId: run.sessionId });
  try {
    if (!(await run.confirm(teleportSummary(manifest)))) return { kind: "declined" };
    if (run.signal?.aborted) return { kind: "cancelled" };
    const { id } = await target("teleport.receive", { manifest });
    try {
      await relay(run, manifest, id);
      const done = await target("teleport.finish", { id, repo: run.repo });
      return { kind: "moved", ...done };
    } catch (error) {
      await quietly(target("teleport.abort", { id }));
      if (error instanceof Cancelled) return { kind: "cancelled" };
      throw error;
    }
  } finally {
    await quietly(source("teleport.cancel", { id: manifest.id }));
  }
}

/** Every part, chunk by chunk, from the source's package to the target's. */
async function relay(run: TeleportRun, manifest: TeleportManifest, id: string): Promise<void> {
  const total = manifest.parts.reduce((sum, part) => sum + part.size, 0);
  let sent = 0;
  for (const part of manifest.parts) {
    let offset = 0;
    let eof = part.size === 0;
    while (!eof) {
      if (run.signal?.aborted) throw new Cancelled();
      const chunk = await run.source("teleport.read", { id: manifest.id, part: part.name, offset });
      await run.target("teleport.write", { id, part: part.name, offset, data: chunk.data });
      const moved = chunk.next > offset;
      if (moved) {
        sent += chunk.next - offset;
        offset = chunk.next;
      }
      // A chunk that does not move on ends the part: a broken source never keeps the app spinning
      // (the target then refuses the part as incomplete).
      eof = chunk.eof || !moved;
      run.onProgress?.(sent, total);
    }
  }
}
