import { type FrameRewriter, installHolds } from "./holds.ts";

/**
 * #3987: the Teleport prints show a move that answers the same on every machine. A real one builds
 * a package on alfa, imports it on beta and archives alfa's copy, which would change the demo's
 * shared hosts for every print after it (and a second import of the same session is refused, #790).
 * So the page's sockets are wrapped with this: the commands of a move (`teleport.*`, and the
 * `session.meta.set` that archives the source's copy) are answered in the page and never sent.
 * `refuses`: the source's package is no manifest, so the app stops the move with its own text.
 * Fake values only (no real path, address or secret).
 *
 * It goes into the page as its source (`teleportScript`), so it uses nothing outside its own body.
 */
// Not instrumented: its source goes into the page, where an istanbul counter would not exist
// (the istanbul shard of a full run, #1492).
/* istanbul ignore next */
export function teleportRewriter(refuses = false): FrameRewriter {
  const parse = (frame: string): Record<string, unknown> | null => {
    try {
      const value: unknown = JSON.parse(frame);
      return typeof value === "object" && value !== null
        ? (value as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  };
  const sizes: Record<string, number> = { transcript: 14_336, code: 4096 };
  const manifest = {
    id: "print-package",
    sessionId: "print-session",
    claudeSessionId: "7e1c2a9b-4f3d-4c8e-9a6b-1d2e3f4a5b6c",
    cwd: "/srv/projects/flightdeck-web",
    model: "claude-sonnet-5-5",
    permissionMode: "default",
    persona: null,
    expiresAt: "2026-11-09T09:00:00.000Z",
    parts: [
      { name: "transcript", size: sizes.transcript, sha256: "a".repeat(64) },
      { name: "code", size: sizes.code, sha256: "b".repeat(64) },
    ],
    secrets: { lines: 2, labels: ["API token", "private key"] },
    git: {
      branch: "feature/cart",
      head: "1".repeat(40),
      base: "origin/main",
      baseSha: "2".repeat(40),
      ref: "refs/teleport/print",
      ahead: 3,
      changed: 5,
    },
  };
  const answers: Record<string, (payload: Record<string, unknown>) => unknown> = {
    // Something that is no manifest, with an id: the app frees the package and refuses with its own text.
    "teleport.prepare": () => (refuses ? { id: manifest.id } : manifest),
    "teleport.read": (payload) => ({
      data: "",
      next: sizes[String(payload.part)] ?? 0,
      eof: true,
    }),
    "teleport.cancel": () => undefined,
    "teleport.receive": () => ({ id: "print-inbox" }),
    "teleport.write": () => ({ written: 0 }),
    "teleport.abort": () => undefined,
    "teleport.finish": () => ({
      sessionId: "print-moved",
      worktree: "/srv/projects/flightdeck-web-teleport",
      branch: "feature/cart",
    }),
    "session.meta.set": () => ({}),
  };
  return {
    fromApp: (frame) => frame,
    fromHost: (frame) => frame,
    answer(frame) {
      const message = parse(frame);
      const type = message?.type;
      const id = message?.id;
      if (typeof type !== "string" || typeof id !== "string" || !(type in answers)) {
        return undefined;
      }
      const payload = (message?.payload ?? {}) as Record<string, unknown>;
      return JSON.stringify({ type: "ack", id, ok: true, data: answers[type]?.(payload) });
    },
  };
}

/** The init script a print adds: the page's WebSocket wrapped with `teleportRewriter`. */
export function teleportScript(refuses: boolean): string {
  const make = `() => (${teleportRewriter.toString()})(${refuses})`;
  return `(${installHolds.toString()})(window, ${make});`;
}
