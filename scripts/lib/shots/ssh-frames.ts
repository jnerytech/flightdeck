import { type FrameRewriter, installHolds } from "./holds.ts";

/**
 * #3943: the SSH Connections prints show the same destinos, the same `~/.ssh/config` names and the
 * same askpass prompt on every machine. The demo's hosts are real daemons that read the machine's
 * own ssh config and never ask for a password, so the page's sockets are wrapped with this: the
 * answers to `ssh.list` and `ssh.import.preview` are replaced by fake ones, and one
 * `askpass.request` follows the first `ssh.list` answer. Fake values only (RFC 5737 addresses and
 * example.test names).
 *
 * It goes into the page as its source (`sshScript`), so it uses nothing outside its own body.
 */
// Not instrumented: its source goes into the page, where an istanbul counter would not exist
// (the istanbul shard of a full run, #1492).
/* istanbul ignore next */
export function sshRewriter(): FrameRewriter {
  return {
    fromApp() {},
    fromHost: (frame) => frame,
  };
}

/** The init script a print adds: the page's WebSocket wrapped with `sshRewriter`. */
export function sshScript(): string {
  return `(${installHolds.toString()})(window, ${sshRewriter.toString()});`;
}
