import { SessionPersona } from "@flightdeck/protocol";
import { z } from "zod";
import { parseJsonOr, parseJsonWith } from "../json-text.ts";

const Payload = z.record(z.string(), z.unknown());

export interface SessionStartOptions {
  /** Receptor base URL, written into the hook command by `hooks install`. */
  url: string;
  token: string;
  /** The hook's JSON, as Claude Code writes it to stdin. */
  input: string;
  env: Record<string, string | undefined>;
  /** Gives up after this long: Claude must never wait on Flightdeck. */
  timeoutMs: number;
}

/** The badge `flightdeckd claude --persona` left in the environment; junk is not forwarded. */
function personaBadge(raw: string | undefined) {
  return parseJsonOr(SessionPersona, raw ?? "", null);
}

/**
 * `flightdeckd hook session-start`: SessionStart only fires as a command hook, so this forwards
 * its input to the receptor, adding the launch id of `flightdeckd claude` and the managed flag of
 * the daemon's own sessions. Any failure is swallowed: exit 0, no output.
 */
export async function sendSessionStart(opts: SessionStartOptions): Promise<void> {
  let payload: Record<string, unknown>;
  try {
    payload = parseJsonWith(Payload, opts.input);
  } catch {
    return;
  }
  const launch = opts.env.FLIGHTDECK_LAUNCH_ID;
  const persona = personaBadge(opts.env.FLIGHTDECK_PERSONA);
  const body = {
    ...payload,
    ...(launch ? { launch_id: launch } : {}),
    ...(persona ? { persona } : {}),
    ...(opts.env.FLIGHTDECK_MANAGED === "1" ? { managed: true } : {}),
  };
  await fetch(`${opts.url}/hooks/SessionStart`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${opts.token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeoutMs),
  }).catch(() => {});
}
