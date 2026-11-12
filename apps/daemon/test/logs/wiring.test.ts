import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHostLog } from "../../src/logs/wiring.ts";
import { tempDir } from "../support/helpers.ts";

/**
 * The daemon's log as main.ts builds it (#255, #1593): every line to the console as said, and to
 * the file with the daemon's tokens and the vault's values taken out, read at each line.
 */
// Bare, prefix-less values, as the real tokens are: no pattern knows their shape.
const TOKEN = "Zk3fakeprotocoltoken0123456789abcdefghijklmnop";
const HOOKS = "Qw8fakehookstoken0123456789abcdefghijklmnop";
const ROTATED = "Lm5fakerotatedtoken0123456789abcdefghijklmnop";
const HELD = "Vx9fakevaultvalue0123456789";

function built() {
  const said: string[] = [];
  const secrets = { token: TOKEN, held: [] as string[] };
  const dir = tempDir("fd-host-log-");
  const { logger, fileLog } = createHostLog({
    console: { log: (m) => said.push(`info ${m}`), error: (m) => said.push(`error ${m}`) },
    dir,
    home: "/home/dev",
    config: { token: TOKEN, hooks: { token: HOOKS } },
    currentToken: () => secrets.token,
    heldValues: () => secrets.held,
  });
  const file = async () => {
    await fileLog.flush();
    return readFileSync(join(dir, "flightdeckd.log"), "utf8");
  };
  return { logger, said, secrets, file };
}

describe("host-log: the daemon's log and what it never writes (#1593)", () => {
  test("a line reaches the console as said and the file at its level", async () => {
    const { logger, said, file } = built();
    logger.log("started");
    logger.error("refused");
    const text = await file();
    expect(said).toEqual(["info started", "error refused"]);
    expect([text.includes("INFO started"), text.includes("ERROR refused")]).toEqual([true, true]);
  });

  test("the tokens, the rotated one and the vault's values never reach the file", async () => {
    const { logger, secrets, file } = built();
    secrets.token = ROTATED;
    secrets.held = [HELD];
    logger.log(`saw ${TOKEN} ${HOOKS} ${ROTATED} ${HELD}`);
    const text = await file();
    expect([TOKEN, HOOKS, ROTATED, HELD].map((s) => text.includes(s))).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect(text.includes("saw [redacted] [redacted] [redacted] [redacted]")).toBe(true);
  });
});
