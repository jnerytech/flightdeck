import { afterEach, describe, expect, test } from "bun:test";
import { DaemonClient } from "../../src/daemon-client/client.ts";
import { config, fakeDaemon, stopAll, TOKEN } from "../board/card-cli-helpers.ts";

afterEach(stopAll);

describe("DaemonClient: a frame this version cannot read (#3522)", () => {
  test("with no stream reading `unreadable`, the daemon's odd frame raises no unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const on = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", on);
    try {
      const daemon = fakeDaemon({});
      const client = await DaemonClient.connect(
        `ws://127.0.0.1:${config(daemon.port).port}`,
        TOKEN,
        "test",
      );
      daemon.push({ type: "nothing-this-version-knows" });
      // Let the event loop turn: an unhandled rejection is reported after the microtasks drain.
      await new Promise((done) => setImmediate(done));
      await new Promise((done) => setImmediate(done));
      expect(unhandled).toEqual([]);
      client.close();
    } finally {
      process.off("unhandledRejection", on);
    }
  });

  test("a stream that does read `unreadable` still gets the rejection", async () => {
    const daemon = fakeDaemon({});
    const client = await DaemonClient.connect(`ws://127.0.0.1:${daemon.port}`, TOKEN, "test");
    daemon.push({ type: "nothing-this-version-knows" });
    await expect(client.unreadable).rejects.toThrow("could not read a frame from the daemon");
    client.close();
  });
});
