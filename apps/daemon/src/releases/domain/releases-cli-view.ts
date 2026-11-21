/**
 * Issue #3736: what `flightdeckd releases list` says, as pure rules over the daemon's answer. The terminal-control
 * scrub is the runner's (`said`, `json`).
 */
import type { ReleaseNote } from "@flightdeck/protocol";

export interface ReleasesCliArgs {
  /** How many releases to read; the daemon's default when absent. */
  limit?: number;
  json?: boolean;
}

export function releasesLines(releases: ReleaseNote[]): string[] {
  if (releases.length === 0) return ["no releases"];
  return [
    `${releases.length} ${releases.length === 1 ? "release" : "releases"}`,
    ...releases.flatMap((release) => [
      `  ${release.tag}  ${release.publishedAt}  ${release.title}`,
      ...release.highlights.map((highlight) => `    - ${highlight}`),
    ]),
  ];
}

/** The keys a script reads, whatever else the daemon adds. */
export const releasesJson = (releases: ReleaseNote[]) =>
  releases.map(({ tag, title, publishedAt, url, highlights }) => ({
    tag,
    title,
    publishedAt,
    url,
    highlights,
  }));
