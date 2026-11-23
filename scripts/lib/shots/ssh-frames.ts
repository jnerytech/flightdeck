import { type FrameRewriter, installHolds } from "./holds.ts";

/**
 * #3943: the SSH Connections prints show the same destinos, the same `~/.ssh/config` names and the
 * same askpass prompt on every machine. The demo's hosts are real daemons that read the machine's
 * own ssh config and never ask for a password, so the page's sockets are wrapped with this: the
 * answers to `ssh.list` and `ssh.import.preview` are replaced by fake ones, and one
 * `askpass.request` follows the first `ssh.list` answer when the print asks for it, and the commands the print
 * names (#4335) are answered in the page, never sent. Fake values only (RFC 5737 addresses and
 * example.test names).
 *
 * It goes into the page as its source (`sshScript`), so it uses nothing outside its own body.
 */
// Not instrumented: its source goes into the page, where an istanbul counter would not exist
// (the istanbul shard of a full run, #1492).
/* istanbul ignore next */
export function sshRewriter(askpass = false, replies: Record<string, unknown> = {}): FrameRewriter {
  const parse = (frame: string): Record<string, unknown> | null => {
    try {
      const value: unknown = JSON.parse(frame);
      return typeof value === "object" && value !== null
        ? (value as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  };
  const stamp = "2026-11-09T08:00:00.000Z";
  const target = (n: number, row: Record<string, unknown>) => ({
    id: `print-ssh-${n}`,
    port: 22,
    viaHost: null,
    secretRef: null,
    jump: null,
    options: {},
    hostKey: null,
    createdAt: stamp,
    updatedAt: stamp,
    ...row,
  });
  const targets = [
    target(1, {
      name: "build-server",
      host: "203.0.113.10",
      user: "deploy",
      tags: ["ci"],
      auth: "agent",
      hostKey: "SHA256:printkeyone",
    }),
    target(2, {
      name: "staging",
      host: "staging.example.test",
      user: "deploy",
      port: 2222,
      tags: ["staging"],
      auth: "password",
    }),
    target(3, {
      name: "docs-site",
      host: "203.0.113.24",
      user: "web",
      tags: ["prod", "web"],
      auth: "agent",
    }),
  ];
  const entry = (alias: string, host: string, user: string, port: number, exists: boolean) => ({
    alias,
    host,
    port,
    user,
    identityFile: null,
    proxyJump: null,
    exists,
  });
  const entries = [
    entry("build-server", "203.0.113.10", "deploy", 22, true),
    entry("lab-box", "lab.example.test", "ops", 22, false),
    entry("edge-gateway", "203.0.113.55", "ops", 2200, false),
  ];
  const prompt = {
    type: "askpass.request",
    requestId: "print-askpass",
    targetId: "print-ssh-2",
    targetName: "staging",
    kind: "password",
    secretRef: null,
    prompt: "deploy@staging.example.test's password:",
  };
  const rewrite: Record<string, () => Record<string, unknown>> = {
    "ssh.list": () => ({ targets }),
    "ssh.import.preview": () => ({ entries }),
  };
  const asked = new Map<string, string>();
  let prompted = false;
  /** The answer `fromHost` just rewrote is the first ssh.list one: the prompt is due. */
  let due = false;
  /** The type of the request a successful answer replies to, `undefined` for any other frame. */
  const answeredType = (frame: string): string | undefined => {
    const message = parse(frame);
    const id = message?.id;
    if (message?.type !== "ack" || message.ok !== true || typeof id !== "string") return undefined;
    return asked.get(id);
  };
  return {
    fromApp(frame) {
      const message = parse(frame);
      const type = message?.type;
      if (typeof type === "string" && type in rewrite && typeof message?.id === "string") {
        asked.set(message.id, type);
      }
      return frame;
    },
    fromHost(frame) {
      const type = answeredType(frame);
      const message = parse(frame);
      if (type === undefined || message === null) return frame;
      asked.delete(String(message.id));
      due = askpass && type === "ssh.list" && !prompted;
      if (due) prompted = true;
      return JSON.stringify({ ...message, data: rewrite[type]?.() });
    },
    answer(frame) {
      const message = parse(frame);
      const type = message?.type;
      if (typeof type !== "string" || !(type in replies) || typeof message?.id !== "string") {
        return undefined;
      }
      return JSON.stringify({ type: "ack", id: message.id, ok: true, data: replies[type] });
    },
    followUp() {
      // `fromHost` marked the first ssh.list answer: the prompt follows it, and only it.
      if (!due) return [];
      due = false;
      return [JSON.stringify(prompt)];
    },
  };
}

/** The init script a print adds: the page's WebSocket wrapped with `sshRewriter`. */
export function sshScript(askpass: boolean, replies: Record<string, unknown> = {}): string {
  const make = `() => (${sshRewriter.toString()})(${askpass}, ${JSON.stringify(replies)})`;
  return `(${installHolds.toString()})(window, ${make});`;
}
