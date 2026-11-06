import { describe, expect, test } from "bun:test";
import { FlightdeckError } from "../src/errors.ts";
import { parseHighlights, ReleaseFeed } from "../src/releases/releases.ts";

const BODY = `## Highlights

- **Global search** (#566): Esc and a click outside close it; \`focus\` returns.
- Home opens at once (#607).
Some words between the bullets are not a bullet.
- Last bullet (#1)

## What's Changed
* fix(x): a PR line (#2) by @someone in https://github.com/o/r/pull/2
`;

const release = (tag: string, over: Record<string, unknown> = {}) => ({
  tag_name: tag,
  name: `Release ${tag}`,
  published_at: "2026-11-06T10:00:00Z",
  html_url: `https://github.com/o/r/releases/tag/${tag}`,
  body: BODY,
  draft: false,
  prerelease: false,
  ...over,
});

function feed(
  answer: () => Response | Promise<Response>,
  clock = { at: 0 },
  options: { url?: string } = {},
) {
  const asked: Array<{ url: string; headers: Record<string, string> }> = [];
  const releases = new ReleaseFeed({
    url: options.url ?? "https://api.example/releases",
    fetch: async (url, init) => {
      asked.push({ url, headers: init.headers });
      return answer();
    },
    now: () => clock.at,
  });
  return { releases, asked, clock };
}

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

describe("releases-lib: the app's release notes from GitHub (issue #125)", () => {
  test("the highlights are the bullets under the Highlights heading, as plain text, up to the next heading", () => {
    expect(parseHighlights(BODY)).toEqual([
      "Global search (#566): Esc and a click outside close it; focus returns.",
      "Home opens at once (#607).",
      "Last bullet (#1)",
    ]);
  });

  test("notes with no Highlights section have none, and a long bullet is cut", () => {
    expect(parseHighlights("## What's Changed\n* a PR")).toEqual([]);
    expect(parseHighlights("")).toEqual([]);
    const [cut] = parseHighlights(`## Highlights\n- ${"word ".repeat(100)}\n`);
    expect((cut ?? "").length).toBeLessThanOrEqual(300);
    expect(cut?.endsWith("…")).toBe(true);
  });

  test("a release is its tag, title, date, link and highlights; drafts and pre-releases are left out", async () => {
    const { releases, asked } = feed(() =>
      json([
        release("v0.37.4"),
        release("v0.38.0-rc.1", { prerelease: true }),
        release("v0.38.0", { draft: true }),
        release("v0.37.3", { name: "", body: null }),
      ]),
    );
    const list = await releases.list(5);
    expect(list.releases.map((r) => r.tag)).toEqual(["v0.37.4", "v0.37.3"]);
    expect(list.releases[0]).toEqual({
      tag: "v0.37.4",
      title: "Release v0.37.4",
      publishedAt: "2026-11-06T10:00:00Z",
      url: "https://github.com/o/r/releases/tag/v0.37.4",
      highlights: parseHighlights(BODY),
    });
    // A release with no title is shown by its tag; with no notes it has no highlights.
    expect(list.releases[1]).toMatchObject({ title: "v0.37.3", highlights: [] });
    expect(asked[0]?.url).toBe("https://api.example/releases?per_page=20");
    expect(asked[0]?.headers.Accept).toBe("application/vnd.github+json");
    expect(asked[0]?.headers["User-Agent"]).toContain("flightdeckd");
  });

  test("the answer is kept for an hour, whatever the limit asked, and read again after", async () => {
    const { releases, asked, clock } = feed(() =>
      json([release("v1"), release("v2"), release("v3")]),
    );
    expect((await releases.list(2)).releases.map((r) => r.tag)).toEqual(["v1", "v2"]);
    clock.at = 59 * 60_000;
    expect((await releases.list(3)).releases).toHaveLength(3);
    expect(asked).toHaveLength(1);
    clock.at = 61 * 60_000;
    await releases.list(2);
    expect(asked).toHaveLength(2);
  });

  test("a failed read is a refusal with its reason, and the next call tries again", async () => {
    const answers: Array<() => Response> = [
      () => json({ message: "rate limited" }, 403),
      () => new Response("not json", { status: 200 }),
      () => json({ not: "a list" }),
      () => json([release("v1")]),
    ];
    const { releases } = feed(() => (answers.shift() as () => Response)());
    for (let i = 0; i < 3; i += 1) {
      const error = await releases.list(5).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(FlightdeckError);
      expect((error as FlightdeckError).reason).toBe("releases_unavailable");
    }
    expect((await releases.list(5)).releases).toHaveLength(1);
  });

  test("a network failure is the same refusal", async () => {
    const releases = new ReleaseFeed({
      url: "https://api.example/releases",
      fetch: async () => {
        throw new Error("offline");
      },
    });
    const error = await releases.list(5).catch((e: unknown) => e);
    expect((error as FlightdeckError).reason).toBe("releases_unavailable");
  });
});
