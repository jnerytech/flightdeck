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

/**
 * `flightdeckd hook session-start`: SessionStart only fires as a command hook, so this forwards
 * its input to the receptor, adding the launch id of `flightdeckd claude` and the managed flag of
 * the daemon's own sessions. Any failure is swallowed: exit 0, no output.
 */
export async function sendSessionStart(opts: SessionStartOptions): Promise<void> {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(opts.input) as Record<string, unknown>;
  } catch {
    return;
  }
  const launch = opts.env.FLIGHTDECK_LAUNCH_ID;
  const body = {
    ...payload,
    ...(launch ? { launch_id: launch } : {}),
    ...(opts.env.FLIGHTDECK_MANAGED === "1" ? { managed: true } : {}),
  };
  await fetch(`${opts.url}/hooks/SessionStart`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${opts.token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeoutMs),
  }).catch(() => {});
}
