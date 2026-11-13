import { describe, expect, test } from "bun:test";
import { ReleaseFeed } from "../../src/releases/releases.ts";
import { createReleases } from "../../src/releases/wiring.ts";

/** The module hands the server the feed of published releases the "what's new" card reads. */
describe("releases-wiring: the module the server takes `releases` from", () => {
  test("it supplies a release feed under the `releases` key", () => {
    const { modules } = createReleases();
    expect(modules[0].server?.releases).toBeInstanceOf(ReleaseFeed);
  });
});
