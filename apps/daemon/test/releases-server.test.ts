import { afterEach, describe, expect, test } from "bun:test";
import type * as protocol from "@flightdeck/protocol";
import { ReleaseFeed } from "../src/releases/releases.ts";
import { startServer } from "../src/server.ts";
import { newManager } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "releases-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function serve(releases?: ReleaseFeed) {
  const ctx = newManager();
  const server = startServer({
    manager: ctx.manager,
    ...(releases ? { releases } : {}),
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [ctx.root],
  });
  cleanups.push(() => server.stop());
  const client = new FrameClient(server.url);
  cleanups.push(() => client.close());
  await client.request("hello", { token: TOKEN, client: "t" });
  return client;
}

const feedOf = (answer: () => Response) =>
  new ReleaseFeed({ url: "https://api.example/releases", fetch: async () => answer() });

describe("releases-server: releases.list over the protocol (issue #125)", () => {
  test("a host with the feed lists the releases, announces the feature, and honours the limit", async () => {
    const client = await serve(
      feedOf(
        () =>
          new Response(
            JSON.stringify(
              ["v3", "v2", "v1"].map((tag) => ({
                tag_name: tag,
                name: tag,
                published_at: "2026-11-06T10:00:00Z",
                html_url: `https://example/${tag}`,
                body: "## Highlights\n- one\n",
                draft: false,
                prerelease: false,
              })),
            ),
          ),
      ),
    );
    const list = await client.data<protocol.ReleaseList>("releases.list", { limit: 2 });
    expect(list?.releases.map((r) => r.tag)).toEqual(["v3", "v2"]);
    expect(list?.releases[0]?.highlights).toEqual(["one"]);
    const info = await client.data<protocol.HostInfoResult>("host.info", {});
    expect(info?.features).toContain("releases");
  });

  test("a host without the feed refuses with feature_off, and a failed read reaches the client with its reason", async () => {
    const off = await serve();
    const refused = await off.request("releases.list", {});
    expect(refused.ok).toBe(false);
    expect(JSON.stringify(refused)).toContain("releases");
    const failing = await serve(feedOf(() => new Response("{}", { status: 500 })));
    const failed = await failing.request("releases.list", {});
    expect(failed.ok).toBe(false);
    expect(JSON.stringify(failed)).toContain("releases_unavailable");
  });
});
