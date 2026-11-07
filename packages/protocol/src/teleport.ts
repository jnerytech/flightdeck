/**
 * Issue #100, teleport: an idle Claude Code session moves to another host. Slice 1 is the source
 * side: a package of the session's transcript, described by a manifest and read in chunks.
 */
import { z } from "zod";
import type { PermissionMode } from "./index.ts";

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
