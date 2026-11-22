import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { CLOSE, fakeDaemon, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

/** The daemon of `ui.set`: it answers the settings it keeps once the request is applied. */
const keeping = (start: { mode: string; locked: boolean }) => {
  const kept = { ...start };
  return fakeDaemon({
    "ui.set": (payload) => {
      if (typeof payload.mode === "string") kept.mode = payload.mode;
      if (typeof payload.locked === "boolean") kept.locked = payload.locked;
      return { ...kept };
    },
  });
};

const sent = (daemon: ReturnType<typeof fakeDaemon>) =>
  daemon.calls.filter((c) => c.type === "ui.set").map((c) => c.payload);

describe("flightdeckd ui set (issue #3781)", () => {
  test("it sends the mode and the lock with the confirm and prints how the host stands", async () => {
    const daemon = keeping({ mode: "full", locked: false });
    const run = await flightdeckd(
      ["ui", "set", "--mode", "simple", "--lock", "--confirm"],
      daemon.port,
    );
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: ["mode simple, locked yes"],
      err: [],
    });
    expect(sent(daemon)).toEqual([{ mode: "simple", locked: true, confirm: true }]);
  });

  test("--json prints the two keys", async () => {
    const daemon = keeping({ mode: "full", locked: true });
    const run = await flightdeckd(["ui", "set", "--unlock", "--confirm", "--json"], daemon.port);
    expect(run.code).toBe(0);
    expect(JSON.parse(run.out.join("\n"))).toEqual({ mode: "full", locked: false });
    expect(sent(daemon)).toEqual([{ locked: false, confirm: true }]);
  });

  test("only the mode is sent when only the mode is given: the lock stays as the daemon has it", async () => {
    const daemon = keeping({ mode: "simple", locked: true });
    const run = await flightdeckd(["ui", "set", "--mode", "full", "--confirm"], daemon.port);
    expect(run.out).toEqual(["mode full, locked yes"]);
    expect(sent(daemon)).toEqual([{ mode: "full", confirm: true }]);
  });

  test("a refused line sends nothing and is exit 1", async () => {
    const daemon = keeping({ mode: "full", locked: false });
    const none = await flightdeckd(["ui", "set", "--confirm"], daemon.port);
    const both = await flightdeckd(["ui", "set", "--lock", "--unlock", "--confirm"], daemon.port);
    const bare = await flightdeckd(["ui", "set", "--lock"], daemon.port);
    expect([none.code, both.code, bare.code]).toEqual([1, 1, 1]);
    expect(daemon.calls).toEqual([]);
  });

  test("the daemon's refusal is exit 1 with its text, and a closed connection is exit 2", async () => {
    const refusing = fakeDaemon({
      "ui.set": () => ({ error: { code: "invalid_state", message: "the daemon says no" } }),
    });
    const gone = fakeDaemon({ "ui.set": () => CLOSE });
    const refused = await flightdeckd(["ui", "set", "--lock", "--confirm"], refusing.port);
    const closed = await flightdeckd(["ui", "set", "--lock", "--confirm"], gone.port);
    expect(refused.code).toBe(1);
    expect(refused.err.join("\n")).toContain("the daemon says no");
    expect(closed.code).toBe(2);
  });
});
