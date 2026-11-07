/**
 * Issue #100, slice 3a: the app moves an idle session from one host to another. It asks the source
 * for a package, shows the person what moves (counts only: no text of the transcript or the code
 * reaches the summary), relays the package's parts chunk by chunk to the target, and has the target
 * import it. Whatever stops it (a no, a cancel, a refusal, a host that went) cleans both sides.
 */
import {
  type CommandPayload,
  type CommandResults,
  type CommandType,
  type TeleportManifest,
  TeleportManifestSchema,
} from "@flightdeck/protocol";
import { RequestError } from "./host-connection.ts";

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
  /** How long a clean-up step may take before the move gives up on it. */
  cleanupMs?: number;
}

export type TeleportOutcome =
  | { kind: "moved"; sessionId: string; worktree: string; branch: string }
  | { kind: "declined" }
  | { kind: "cancelled" };

/** How long the clean-up may take before the move gives up on it. */
const CLEANUP_MS = 5_000;
/** Control and format characters (direction marks among them). */
const MARKS = /[\p{Cc}\p{Cf}]/gu;

export function teleportSummary(manifest: TeleportManifest): TeleportSummary {
  const branch = manifest.git?.branch;
  return {
    // The source's text: shown as the plain text it is, with no mark that could disguise it.
    branch: branch ? branch.replace(MARKS, "").slice(0, 255) : null,
    ahead: manifest.git?.ahead ?? 0,
    changed: manifest.git?.changed ?? 0,
    bytes: manifest.parts.reduce((sum, part) => sum + part.size, 0),
    // The count only: the scanner's kinds stay on the hosts (and are not yet translated, #714).
    secretLines: manifest.secrets.lines,
  };
}

/** The move was cancelled: not an error, an outcome. */
class Cancelled extends Error {}

/** What the source sent does not hold together: refused with a reason the person can read. */
const refused = (reason: "teleport_corrupt" | "teleport_incomplete") =>
  new RequestError("bad_request", reason.replaceAll("_", " "), reason);

export async function teleportSession(run: TeleportRun): Promise<TeleportOutcome> {
  const { source, target } = run;
  const manifest = await source("teleport.prepare", { sessionId: run.sessionId });
  let id: string | null = null;
  let landed = false;
  try {
    // The source's manifest is checked as the target would: sizes, parts, names.
    if (!TeleportManifestSchema.safeParse(manifest).success) throw refused("teleport_corrupt");
    if (!(await run.confirm(teleportSummary(manifest)))) return { kind: "declined" };
    if (run.signal?.aborted) return { kind: "cancelled" };
    id = (await target("teleport.receive", { manifest })).id;
    await relay(run, manifest, id);
    const done = await target("teleport.finish", { id, repo: run.repo });
    landed = true;
    return { kind: "moved", ...done };
  } catch (error) {
    if (error instanceof Cancelled) return { kind: "cancelled" };
    throw error;
  } finally {
    await cleanUp(run, manifest.id, landed ? null : id);
  }
}

/**
 * Both hosts drop what they hold for this move, at once and for a limited time: a host that went or
 * does not answer never hides why the move stopped, nor holds it.
 */
async function cleanUp(run: TeleportRun, packageId: string, received: string | null) {
  const steps = [
    ...(received ? [run.target("teleport.abort", { id: received })] : []),
    run.source("teleport.cancel", { id: packageId }),
  ];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise((resolve) => {
    timer = setTimeout(resolve, run.cleanupMs ?? CLEANUP_MS);
  });
  await Promise.race([Promise.allSettled(steps), limit]);
  clearTimeout(timer);
}

/** Every part, chunk by chunk, from the source's package to the target's, never past its size. */
async function relay(run: TeleportRun, manifest: TeleportManifest, id: string): Promise<void> {
  const total = manifest.parts.reduce((sum, part) => sum + part.size, 0);
  let sent = 0;
  for (const part of manifest.parts) {
    let offset = 0;
    while (offset < part.size) {
      if (run.signal?.aborted) throw new Cancelled();
      const chunk = await run.source("teleport.read", { id: manifest.id, part: part.name, offset });
      // A chunk that does not move on, or goes past the part, ends the move: a broken source never
      // keeps the app spinning.
      if (chunk.next <= offset) throw refused("teleport_incomplete");
      if (chunk.next > part.size) throw refused("teleport_corrupt");
      await run.target("teleport.write", { id, part: part.name, offset, data: chunk.data });
      sent += chunk.next - offset;
      offset = chunk.next;
      run.onProgress?.(sent, total);
      if (chunk.eof && offset < part.size) throw refused("teleport_incomplete");
    }
  }
}
