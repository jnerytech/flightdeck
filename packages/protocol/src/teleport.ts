/**
 * Issue #100, teleport: an idle Claude Code session moves to another host. Slice 1 is the source
 * side: a package of the session's transcript, described by a manifest and read in chunks.
 */
import { z } from "zod";
// A value import: the manifest schema reads it lazily, once index.ts has run (the two import each other).
import { PermissionMode } from "./index.ts";

/** `teleport.prepare`: package an idle session of this host. */
export const TeleportPreparePayload = z.object({ sessionId: z.string().min(1) });

/** `teleport.read`: one chunk of a part of a package, from `offset`. */
export const TeleportReadPayload = z.object({
  id: z.string().min(1).max(64),
  part: z.string().min(1).max(32),
  offset: z.number().int().nonnegative(),
});

/** `teleport.cancel`: the package goes now. */
export const TeleportCancelPayload = z.object({ id: z.string().min(1).max(64) });

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const Count = z.number().int().nonnegative();
/** The largest part a teleport carries (the daemons refuse more): 64 MiB. */
export const TELEPORT_PART_MAX_BYTES = 64 * 1024 * 1024;
const PartName = z.enum(["transcript", "code"]);

/** The manifest as the source host made it; the target checks it before it takes a byte. */
export const TeleportManifestSchema = z.object({
  id: z.string().min(1).max(64),
  sessionId: z.string().min(1).max(200),
  claudeSessionId: z.string().min(1).max(64),
  cwd: z.string().min(1).max(4096),
  model: z.string().max(200).nullable(),
  permissionMode: z.lazy(() => PermissionMode),
  persona: z.string().max(200).nullable(),
  expiresAt: z.string().max(64),
  parts: z
    .array(z.object({ name: PartName, size: Count.max(TELEPORT_PART_MAX_BYTES), sha256: Sha256 }))
    .min(1)
    .max(2),
  secrets: z.object({ lines: Count, labels: z.array(z.string().max(100)).max(50) }),
  git: z
    .object({
      branch: z.string().max(255).nullable(),
      head: z.string().regex(/^[0-9a-f]{40,64}$/),
      base: z.string().min(1).max(255),
      baseSha: z.string().regex(/^[0-9a-f]{40,64}$/),
      ref: z.string().min(1).max(255),
      ahead: Count,
      changed: Count,
    })
    .optional(),
});

/** `teleport.receive`: this host takes a package from another; the answer names it here. */
export const TeleportReceivePayload = z.object({ manifest: TeleportManifestSchema });

/** `teleport.write`: one chunk of a part, at the offset the part has reached (128 KiB, in base64). */
export const TeleportWritePayload = z.object({
  id: z.string().min(1).max(64),
  part: PartName,
  offset: Count,
  data: z.string().max(180_000),
});

/** `teleport.finish`: the received package becomes a session in a new worktree of `repo`. */
export const TeleportFinishPayload = z.object({
  id: z.string().min(1).max(64),
  repo: z.string().min(1).max(4096),
});

/** `teleport.abort`: what this host received of a package goes now. */
export const TeleportAbortPayload = z.object({ id: z.string().min(1).max(64) });

/** What a package holds: the session's settings, each part's size and sha256, and what looks like a secret (counts and kinds, never the text). */
export interface TeleportManifest {
  id: string;
  sessionId: string;
  claudeSessionId: string;
  cwd: string;
  model: string | null;
  permissionMode: PermissionMode;
  persona: string | null;
  expiresAt: string;
  parts: Array<{ name: "transcript" | "code"; size: number; sha256: string }>;
  secrets: { lines: number; labels: string[] };
  /** The code part (slice 1b): the branch, HEAD, the base on origin it starts from, the ref the bundle carries, and what moves. */
  git?: {
    branch: string | null;
    head: string;
    base: string;
    /** The commit `base` named on the source: the target checks its origin has it. */
    baseSha: string;
    ref: string;
    ahead: number;
    changed: number;
  };
}

/** One chunk of a part: the bytes in base64, where the next one starts, and whether this was the last. */
export interface TeleportChunk {
  data: string;
  next: number;
  eof: boolean;
}
