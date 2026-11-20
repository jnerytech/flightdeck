/**
 * The approvers command of the command line (#3439): `flightdeckd approvers enroll` and `reset`. They
 * write the store of the host directly, from its terminal: no protocol command opens the window of the
 * first device or removes a key.
 */
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { loadConfig } from "../config.ts";
import { FlightdeckError } from "../kernel/index.ts";
import { Approvers } from "../permissions/index.ts";
import { EventStore } from "../store/index.ts";
import { configPath } from "./config-path.ts";
import type { CliArgs } from "./domain/args.ts";
import type { MaintenanceCommandDeps } from "./maintenance.ts";

/** The one-time code: 128 bits, as the person types it into the app. */
const CODE_BYTES = 16;

/** `flightdeckd approvers enroll|reset [--json]`: 0 done, 1 refused. Works with the daemon running or not. */
export async function runApprovers(
  args: CliArgs,
  deps: MaintenanceCommandDeps & { log: { error(line: string): void } },
): Promise<number> {
  const config = await loadConfig(configPath(args));
  const store = await EventStore.open(join(config.dataDir, "flightdeck.db"));
  try {
    const approvers = new Approvers(store.db, {
      now: () => new Date(deps.now?.() ?? Date.now()),
      mono: () => performance.now(),
      random: () => randomBytes(24).toString("base64url"),
    });
    const say = (text: string, json: unknown) =>
      deps.log.log(args.json ? JSON.stringify(json) : text);
    if (args.action === "reset") {
      const removed = approvers.store.reset();
      say(
        removed === 0
          ? "no enrolled device: protection is off"
          : `removed ${removed} enrolled device${removed === 1 ? "" : "s"}: protection is off`,
        { removed },
      );
      return 0;
    }
    const code = randomBytes(CODE_BYTES).toString("base64url");
    const until = approvers.openEnrollment(code);
    say(
      [
        `enrollment code: ${code}`,
        "Type it into the app within 10 minutes. The window closes then, or when the first device enrolls.",
      ].join("\n"),
      { code, expiresAt: until.toISOString() },
    );
    return 0;
  } catch (error) {
    if (!(error instanceof FlightdeckError)) throw error;
    deps.log.error(`flightdeckd: ${error.message}`);
    return 1;
  } finally {
    store.close();
  }
}
