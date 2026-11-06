import { describe, expect, test } from "bun:test";
import type { ReleaseNote } from "@flightdeck/protocol";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { AppStore } = await import("../src/lib/app-store.ts");

const note = (tag: string): ReleaseNote => ({
  tag,
  title: `Release ${tag}`,
  publishedAt: "2026-11-06T10:00:00Z",
  url: `https://github.com/o/r/releases/tag/${tag}`,
  highlights: ["one"],
});

function setup(
  hosts: Array<{ id: string; status: string; features: string[] }>,
  answer: (hostId: string) => unknown,
) {
  const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  (store as unknown as { update(patch: object): void }).update({
    hosts: hosts.map((h) => ({
      id: h.id,
      name: h.id,
      status: h.status,
      hostInfo: { daemonVersion: "x", features: h.features },
      sessions: [],
    })),
  });
  const asked: string[] = [];
  store.hostRequest = (async (hostId: string, type: string) => {
    asked.push(`${hostId}:${type}`);
    return answer(hostId);
  }) as never;
  return { store, asked };
}

describe("whats-new-store: the releases are read through the first online host that offers them (issue #125)", () => {
  test("the first online host with the feature answers; the others are not asked", async () => {
    const { store, asked } = setup(
      [
        { id: "off", status: "offline", features: ["releases"] },
        { id: "old", status: "online", features: [] },
        { id: "a", status: "online", features: ["releases"] },
        { id: "b", status: "online", features: ["releases"] },
      ],
      () => ({ ok: true, data: { releases: [note("v2"), note("v1")] } }),
    );
    const result = await store.releaseNotes();
    expect(result).toEqual({ kind: "ready", releases: [note("v2"), note("v1")] });
    expect(asked).toEqual(["a:releases.list"]);
  });

  test("with no online host that offers them there is nothing to read", async () => {
    const { store, asked } = setup([{ id: "old", status: "online", features: [] }], () => ({
      ok: true,
      data: { releases: [] },
    }));
    expect(await store.releaseNotes()).toEqual({ kind: "none" });
    expect(asked).toEqual([]);
  });

  test("a refusal is the translated sentence, and the next call asks again", async () => {
    let refuse = true;
    const { store, asked } = setup([{ id: "a", status: "online", features: ["releases"] }], () =>
      refuse
        ? { ok: false, code: "internal", message: "x", reason: "releases_unavailable" }
        : { ok: true, data: { releases: [note("v1")] } },
    );
    const failed = await store.releaseNotes();
    expect(failed).toEqual({
      kind: "error",
      message: "The release notes could not be read from GitHub: try again later.",
    });
    refuse = false;
    expect((await store.releaseNotes()).kind).toBe("ready");
    expect(asked).toHaveLength(2);
  });
});
