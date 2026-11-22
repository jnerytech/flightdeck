import { type FrameRewriter, installHolds } from "./holds.ts";

/** What the What's new print shows (#4059). */
export type ReleasesMode = "list" | "error" | "loading" | "none";

/**
 * The demo's hosts read the app's releases from GitHub, so a print would show whatever was published
 * last and could fail on a rate limit. The What's new prints wrap the page's sockets with this: the
 * answer to `releases.list` is made in the page and never sent (`list`, `error`), the host's answer
 * is dropped so the dialog stays on its loading line (`loading`), or the hosts stop offering the
 * feed, so the dialog says no host can read it (`none`).
 *
 * It goes into the page as its source (`releasesScript`), so it uses nothing outside its own body.
 */
// Not instrumented: its source goes into the page, where an istanbul counter would not exist
// (the istanbul shard of a full run, #1492).
/* istanbul ignore next */
export function releasesRewriter(mode: ReleasesMode): FrameRewriter {
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
  const releases = [
    {
      tag: "v0.38.11",
      title: "v0.38.11",
      publishedAt: "2026-11-21T18:00:00.000Z",
      url: "https://github.com/jnerytech/flightdeck/releases/tag/v0.38.11",
      highlights: [
        "The update banner says what went wrong and offers Settings.",
        "A new version is announced once, politely, by the screen reader.",
      ],
    },
    {
      tag: "v0.38.10",
      title: "v0.38.10",
      publishedAt: "2026-11-20T12:00:00.000Z",
      url: "https://github.com/jnerytech/flightdeck/releases/tag/v0.38.10",
      highlights: ["Teams show their footer on narrow windows."],
    },
    {
      tag: "v0.38.9",
      title: "v0.38.9",
      publishedAt: "2026-11-19T09:00:00.000Z",
      url: "https://github.com/jnerytech/flightdeck/releases/tag/v0.38.9",
      highlights: [],
    },
  ];
  /** The commands noted by id: `releases.list` to hold, `host.info` to rewrite. */
  const asked = new Map<string, string>();
  return {
    fromApp(frame) {
      const message = parse(frame);
      const type = message?.type;
      const id = message?.id;
      let noted = "";
      if (mode === "none") noted = "host.info";
      else if (mode === "loading") noted = "releases.list";
      if (typeof id === "string" && type === noted) asked.set(id, noted);
      return frame;
    },
    fromHost(frame) {
      const message = parse(frame);
      const id = message?.id;
      if (message?.type !== "ack" || typeof id !== "string") return frame;
      if (mode !== "none" || asked.get(id) !== "host.info") return frame;
      asked.delete(id);
      const data = message.data as { features?: unknown } | undefined;
      if (message.ok !== true || !Array.isArray(data?.features)) return frame;
      const features = data.features.filter((feature) => feature !== "releases");
      return JSON.stringify({ ...message, data: { ...data, features } });
    },
    drops(frame) {
      const message = parse(frame);
      const id = message?.id;
      return (
        mode === "loading" &&
        message?.type === "ack" &&
        typeof id === "string" &&
        asked.get(id) === "releases.list"
      );
    },
    answer(frame) {
      const message = parse(frame);
      const id = message?.id;
      if (message?.type !== "releases.list" || typeof id !== "string") return undefined;
      if (mode === "list") return JSON.stringify({ type: "ack", id, ok: true, data: { releases } });
      if (mode !== "error") return undefined;
      const error = {
        code: "internal",
        message: "releases unavailable",
        reason: "releases_unavailable",
      };
      return JSON.stringify({ type: "ack", id, ok: false, error });
    },
  };
}

/** The init script a print adds: the page's WebSocket wrapped with `releasesRewriter`. */
export function releasesScript(mode: ReleasesMode): string {
  return `(${installHolds.toString()})(window, () => (${releasesRewriter.toString()})(${JSON.stringify(mode)}));`;
}
