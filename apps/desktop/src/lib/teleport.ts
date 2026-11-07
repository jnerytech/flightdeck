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

/** What the app's dialog hands the store for a move: the target, the repository, the person's say. */
export interface TeleportRunArgs {
  target: string;
  repo: string;
  confirm(summary: TeleportSummary): Promise<boolean>;
  onProgress(sent: number, total: number): void;
  signal: AbortSignal;
}

export type TeleportOutcome =
  | { kind: "moved"; sessionId: string; worktree: string; branch: string }
  | { kind: "declined" }
  | { kind: "cancelled" };

/** How long the clean-up may take before the move gives up on it. */
const CLEANUP_MS = 5_000;
/** Control and format characters (direction marks among them). */
const MARKS = /[\p{Cc}\p{Cf}]/gu;

/** A host's text shown as the plain text it is: no mark that could disguise it, at most `max` long. */
export const plainText = (text: string, max: number): string =>
  text.replace(MARKS, "").slice(0, max);

export function teleportSummary(manifest: TeleportManifest): TeleportSummary {
  const branch = manifest.git?.branch ? plainText(manifest.git.branch, 255) : null;
  return {
    branch: branch || null,
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

const ignore = () => {};

/** The package id a source's answer names, when it is one: the source's own, never made up. */
function packageId(prepared: unknown): string | null {
  const named = TeleportManifestSchema.shape.id.safeParse(
    (prepared as { id?: unknown } | null)?.id,
  );
  return named.success ? named.data : null;
}

export async function teleportSession(run: TeleportRun): Promise<TeleportOutcome> {
  const { source, target } = run;
  let prepared: unknown;
  try {
    // A source that answers after a cancel still drops the package it made.
    prepared = await unlessCancelled(
      run.signal,
      source("teleport.prepare", { sessionId: run.sessionId }),
      (late) => {
        const lateId = packageId(late);
        if (lateId) source("teleport.cancel", { id: lateId }).catch(ignore);
      },
    );
  } catch (error) {
    if (error instanceof Cancelled) return { kind: "cancelled" };
    throw error;
  }
  // The source's manifest is checked as the target would: sizes, parts, names. One that is not a
  // manifest is refused before anything else uses it; its package is still freed when it names one.
  const checked = TeleportManifestSchema.safeParse(prepared);
  if (!checked.success) {
    const named = packageId(prepared);
    if (named) await cleanUp(run, named, null);
    throw refused("teleport_corrupt");
  }
  const manifest = checked.data as TeleportManifest;
  let id: string | null = null;
  let landed = false;
  try {
    if (!(await run.confirm(teleportSummary(manifest)))) return { kind: "declined" };
    if (run.signal?.aborted) return { kind: "cancelled" };
    // A target that opens its inbox after a cancel still drops it.
    id = (
      await unlessCancelled(run.signal, target("teleport.receive", { manifest }), (late) => {
        if (typeof late?.id === "string") target("teleport.abort", { id: late.id }).catch(ignore);
      })
    ).id;
    await relay(run, manifest, id);
    // The last chance to stop: once the target imports, the session is there.
    if (run.signal?.aborted) throw new Cancelled();
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

/**
 * A host's answer during the transfer, or the cancel, whichever comes first: a host that does not
 * answer never holds a move the person stopped. The clean-up then drops what the target holds.
 */
function unlessCancelled<T>(
  signal: AbortSignal | undefined,
  work: Promise<T>,
  /** What to free when the host answers after the cancel. */
  late?: (value: T) => void,
): Promise<T> {
  if (!signal) return work;
  const abandon = () => {
    work.then((value) => late?.(value), ignore);
    return new Cancelled();
  };
  if (signal.aborted) return Promise.reject(abandon());
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(abandon());
    signal.addEventListener("abort", stop, { once: true });
    // Settled first: the cancel no longer applies to this answer.
    const done = () => signal.removeEventListener("abort", stop);
    work.then(
      (value) => {
        done();
        resolve(value);
      },
      (error: unknown) => {
        done();
        reject(error);
      },
    );
  });
}

/** Every part, chunk by chunk, from the source's package to the target's, never past its size. */
async function relay(run: TeleportRun, manifest: TeleportManifest, id: string): Promise<void> {
  const total = manifest.parts.reduce((sum, part) => sum + part.size, 0);
  let sent = 0;
  for (const part of manifest.parts) {
    let offset = 0;
    while (offset < part.size) {
      const chunk = await unlessCancelled(
        run.signal,
        run.source("teleport.read", { id: manifest.id, part: part.name, offset }),
      );
      // A chunk that does not move on, or goes past the part, ends the move: a broken source never
      // keeps the app spinning.
      if (chunk.next <= offset) throw refused("teleport_incomplete");
      if (chunk.next > part.size) throw refused("teleport_corrupt");
      await unlessCancelled(
        run.signal,
        run.target("teleport.write", { id, part: part.name, offset, data: chunk.data }),
      );
      sent += chunk.next - offset;
      offset = chunk.next;
      run.onProgress?.(sent, total);
      if (chunk.eof && offset < part.size) throw refused("teleport_incomplete");
    }
  }
}
