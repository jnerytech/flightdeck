import { type MaskedSecret, maskOutput } from "./mask.ts";

/** What comes back to Claude is at most this long. */
const MAX_OUTPUT = 32 * 1024;
const MAX_STDOUT = 24 * 1024;
const MAX_STDERR = MAX_OUTPUT - MAX_STDOUT;

/** One stream, masked and then cut to `limit`. */
function finishStream(
  raw: string,
  capped: boolean,
  secrets: MaskedSecret[],
  limit: number,
): { text: string; truncated: boolean } {
  // Masked whole before any cut, so a secret never leaves half of itself at the end.
  const masked = maskOutput(raw, secrets);
  return masked.length > limit
    ? { text: `${masked.slice(0, limit)}\n[saída cortada]`, truncated: true }
    : { text: masked, truncated: capped };
}

/** stdout then stderr, each masked and with its share of the 32 KB. */
export function finish(
  streams: { out: string; err: string; outCapped: boolean; errCapped: boolean },
  secrets: MaskedSecret[],
) {
  const out = finishStream(streams.out, streams.outCapped, secrets, MAX_STDOUT);
  const err = finishStream(streams.err, streams.errCapped, secrets, MAX_STDERR);
  return {
    truncated: out.truncated || err.truncated,
    output: err.text ? `${out.text}\n[stderr]\n${err.text}` : out.text,
  };
}
