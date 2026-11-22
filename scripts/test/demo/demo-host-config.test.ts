import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync } from "node:fs";
import { host } from "../../lib/demo/seed-host.ts";
import { realTempDir } from "../temp-dir.ts";

setDefaultTimeout(60_000);

/**
 * #3989: ssh runs the askpass helper, which reads the host's config file to find the daemon. A demo host
 * listens on a free port, so the file must hold the port it got, not the 0 it asked for.
 */
describe("a demo host's config file", () => {
  test("holds the port the daemon listens on, so the askpass helper can reach it", async () => {
    const run = await host(realTempDir("fd-demo-host-"), "alfa");
    try {
      const { port } = JSON.parse(readFileSync(run.config, "utf8")) as { port: number };
      expect(port).toBe(Number(new URL(run.url).port));
    } finally {
      await run.stop();
    }
  });
});
