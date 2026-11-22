import { describe, expect, test } from "bun:test";
import { ReleaseList } from "@flightdeck/protocol";
import { releasesRewriter, releasesScript } from "../../lib/shots/releases.ts";

/**
 * #4059: the What's new dialog has four states (loading, none, error, the list) that the demo's
 * hosts cannot be left in: they read GitHub's releases. The print answers `releases.list` in the
 * page, so every machine prints the same and no request leaves it.
 */
const ask = (id: string, type: string) => JSON.stringify({ id, type, payload: {} });
const ack = (id: string, data: object) => JSON.stringify({ type: "ack", id, ok: true, data });
const read = (frame: string | undefined) => JSON.parse(frame ?? "null") as Record<string, unknown>;

describe("shots-releases: what the page answers to releases.list", () => {
  test("list: the answer is ok and carries releases the protocol accepts, one of them with no highlights", () => {
    const answer = releasesRewriter("list").answer?.(ask("r1", "releases.list"));
    const data = read(answer).data;
    const parsed = ReleaseList.safeParse(data);
    expect([read(answer).ok, read(answer).id, parsed.success]).toEqual([true, "r1", true]);
    const releases = parsed.success ? parsed.data.releases : [];
    expect([releases.length > 1, releases.some((r) => r.highlights.length === 0)]).toEqual([
      true,
      true,
    ]);
  });

  test("error: the answer is a refusal the app has a text for", () => {
    const answer = read(releasesRewriter("error").answer?.(ask("r1", "releases.list")));
    expect([answer.ok, answer.error]).toEqual([
      false,
      { code: "internal", message: "releases unavailable", reason: "releases_unavailable" },
    ]);
  });

  test("a command that is not releases.list is not answered by the page", () => {
    for (const mode of ["list", "error", "loading", "none"] as const) {
      expect(releasesRewriter(mode).answer?.(ask("r1", "host.info"))).toBeUndefined();
    }
  });

  test("loading: the page never answers, and the host's answer to releases.list is dropped", () => {
    const rewriter = releasesRewriter("loading");
    rewriter.fromApp(ask("r1", "releases.list"));
    rewriter.fromApp(ask("r2", "host.info"));
    expect([
      rewriter.answer?.(ask("r1", "releases.list")),
      rewriter.drops?.(ack("r1", { releases: [] })),
      rewriter.drops?.(ack("r2", {})),
    ]).toEqual([undefined, true, false]);
  });

  test("none: the hosts' host.info stops offering releases, and keeps every other feature", () => {
    const rewriter = releasesRewriter("none");
    rewriter.fromApp(ask("h1", "host.info"));
    const info = { version: "0.38.11", features: ["maintenance", "releases", "teleport"] };
    expect(read(rewriter.fromHost(ack("h1", info))).data).toEqual({
      version: "0.38.11",
      features: ["maintenance", "teleport"],
    });
  });

  test("none: other answers, and frames that are not JSON, pass as they came", () => {
    const rewriter = releasesRewriter("none");
    rewriter.fromApp(ask("h1", "host.info"));
    const other = ack("x9", { features: ["releases"] });
    expect([rewriter.fromHost(other), rewriter.fromHost("not json")]).toEqual([other, "not json"]);
  });

  test("the script puts the page's WebSocket behind the rewriter in the chosen mode", () => {
    const script = releasesScript("error");
    expect([script.includes("WebSocket"), script.includes('("error")')]).toEqual([true, true]);
  });
});
