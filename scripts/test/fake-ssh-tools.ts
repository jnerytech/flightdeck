#!/usr/bin/env bun
/**
 * The fake OpenSSH tools of `smoke:ssh`, one program run as `bun fake-ssh-tools.ts <tool> ...`:
 * `keyscan` (ssh-keyscan answering from a JSON file), `ssh` (records its argv, checks it got a
 * key, runs SSH_ASKPASS when asked for a password), and on Unix `agent` and `add` (ssh-agent and
 * ssh-add keeping the key next to a socket file). Nothing here touches the network or a real key.
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

/** The text every test private key of the smoke carries. */
export const KEY_MARKER = "SMOKE-TEST-KEY-MARKER";

const [tool, ...args] = process.argv.slice(2);
const log = process.env.FD_FAKE_LOG;
const record = (entry: Record<string, unknown>) => {
  if (log) appendFileSync(log, `${JSON.stringify(entry)}\n`);
};

if (tool === "keyscan") {
  const host = args.at(-1) ?? "";
  const keys = JSON.parse(readFileSync(process.env.FD_FAKE_KEYS ?? "", "utf8")) as Record<
    string,
    string
  >;
  const key = keys[host];
  if (!key) process.exit(1);
  console.log(`# ${host}:22 SSH-2.0-Fake`);
  console.log(`${host} ${key}`);
  process.exit(0);
}

if (tool === "agent") {
  const sock = args[args.indexOf("-a") + 1] ?? "";
  writeFileSync(sock, "");
  record({ tool: "agent", sock, pid: process.pid });
  const bye = () => {
    rmSync(sock, { force: true });
    rmSync(`${sock}.key`, { force: true });
    process.exit(0);
  };
  process.on("SIGTERM", bye);
  process.on("SIGINT", bye);
  setInterval(() => {}, 1000);
}

if (tool === "add") {
  const sock = process.env.SSH_AUTH_SOCK ?? "";
  const key = await Bun.stdin.text();
  if (!sock || !key.includes(KEY_MARKER)) process.exit(1);
  writeFileSync(`${sock}.key`, "loaded");
  process.exit(0);
}

if (tool === "ssh") {
  const target = args.at(-1) ?? "";
  record({ tool: "ssh", argv: args, hasAskpass: Boolean(process.env.SSH_ASKPASS) });
  let status = "NO-KEY";
  const identity = args.indexOf("-i");
  if (identity >= 0) {
    const file = args[identity + 1] ?? "";
    const ok = existsSync(file) && readFileSync(file, "utf8").includes(KEY_MARKER);
    status = ok ? "KEY-FILE-OK" : "KEY-FILE-BAD";
  } else if (process.env.SSH_AUTH_SOCK) {
    status = existsSync(`${process.env.SSH_AUTH_SOCK}.key`) ? "AGENT-OK" : "AGENT-EMPTY";
  }
  if (process.env.SSH_ASKPASS && args.includes("PubkeyAuthentication=no")) {
    const host = target.split("@").pop();
    const asked = Bun.spawn(
      [process.env.SSH_ASKPASS, `${target.split("@")[0]}@${host}'s password:`],
      {
        stdout: "pipe",
        stderr: "pipe",
        env: process.env,
      },
    );
    const out = (await new Response(asked.stdout).text()).trim();
    const hash = createHash("sha256").update(out).digest("hex");
    status =
      (await asked.exited) === 0 && hash === process.env.FD_FAKE_PASSWORD_SHA256
        ? "PASSWORD-OK"
        : "PASSWORD-BAD";
  }
  console.log(`${status} FAKE-SSH-CONNECTED`);
  await Bun.sleep(300);
  process.exit(0);
}
