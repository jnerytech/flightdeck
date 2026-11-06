import type { ReleaseList, ReleaseNote } from "@flightdeck/protocol";
import { z } from "zod";
import { FlightdeckError } from "../errors.ts";

export interface ReleaseFeedOptions {
  /** The GitHub API's list of the repository's releases. */
  url: string;
  fetch?: (
    url: string,
    init: { headers: Record<string, string>; signal?: AbortSignal },
  ) => Promise<Response>;
  now?: () => number;
}

/** How long a read is kept: a screen opened often asks GitHub once an hour. */
const KEEP_MS = 60 * 60_000;
/** The page asked for: the most the protocol lets a caller want, so every call can be served from it. */
const PER_PAGE = 20;
const TIMEOUT_MS = 10_000;
const MAX_BULLET = 300;

/** The part of a GitHub release that the app shows; the rest of what GitHub sends is ignored. */
const GithubRelease = z.object({
  tag_name: z.string(),
  name: z.string().nullish(),
  published_at: z.string().nullish(),
  html_url: z.string(),
  body: z.string().nullish(),
  draft: z.boolean().optional(),
  prerelease: z.boolean().optional(),
});
const GithubReleases = z.array(GithubRelease);

/** A bullet as plain text: no bold, code or link markup, cut to a line a card can show. */
function plain(text: string): string {
  const clean = text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "")
    .trim();
  return clean.length > MAX_BULLET ? `${clean.slice(0, MAX_BULLET - 1).trimEnd()}…` : clean;
}

/** The bullets of the `## Highlights` section of a release's notes, as plain text. */
export function parseHighlights(body: string): string[] {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s+highlights\s*$/i.test(line.trim()));
  if (start < 0) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^##\s/.test(line));
  return (end < 0 ? rest : rest.slice(0, end))
    .filter((line) => /^\s*[-*]\s+/.test(line))
    .map((line) => plain(line.replace(/^\s*[-*]\s+/, "")))
    .filter((line) => line !== "");
}

const unavailable = (why: string) =>
  new FlightdeckError(
    "internal",
    `não foi possível ler as notas de versão: ${why}`,
    "releases_unavailable",
  );

/** The app's latest releases from GitHub, kept for an hour so a screen opened often asks once. */
export class ReleaseFeed {
  private kept: { at: number; releases: ReleaseNote[] } | null = null;
  private readonly fetchIt: NonNullable<ReleaseFeedOptions["fetch"]>;
  private readonly now: () => number;

  constructor(private readonly opts: ReleaseFeedOptions) {
    this.fetchIt = opts.fetch ?? ((url, init) => fetch(url, init));
    this.now = opts.now ?? Date.now;
  }

  async list(limit: number): Promise<ReleaseList> {
    const kept = this.kept;
    if (kept && this.now() - kept.at < KEEP_MS) return { releases: kept.releases.slice(0, limit) };
    const releases = await this.read();
    this.kept = { at: this.now(), releases };
    return { releases: releases.slice(0, limit) };
  }

  /** The published releases, newest first as GitHub sends them; a failed read is a refusal. */
  private async read(): Promise<ReleaseNote[]> {
    let response: Response;
    try {
      response = await this.fetchIt(`${this.opts.url}?per_page=${PER_PAGE}`, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "flightdeckd" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw unavailable((error as Error).message);
    }
    if (!response.ok) throw unavailable(`GitHub answered ${response.status}`);
    const parsed = GithubReleases.safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw unavailable("an answer that is not a list of releases");
    return parsed.data
      .filter((release) => !release.draft && !release.prerelease)
      .map((release) => ({
        tag: release.tag_name,
        title: release.name?.trim() || release.tag_name,
        publishedAt: release.published_at ?? "",
        url: release.html_url,
        highlights: parseHighlights(release.body ?? ""),
      }));
  }
}
