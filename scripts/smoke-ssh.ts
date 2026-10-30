#!/usr/bin/env bun
import { createHash } from "node:crypto";
/**
 * SSH smoke: a `--runtime fake` daemon with fake OpenSSH tools first on its PATH (ssh-keyscan
 * answering from a file, a ssh that records its argv, requires the key it was given and runs the
 * SSH_ASKPASS helper, and on Unix a ssh-agent and ssh-add of its own). A fixture ~/.ssh/config
 * (under the home guard, never the user's) is imported; a vault-key destino connects only after
 * its fingerprint is confirmed, with the key delivered for that one connection and gone after it;
 * a password destino gets its password from the app through `flightdeckd askpass`; and a server
 * whose key changed is blocked with both fingerprints. No real ssh, key or server is involved.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { delimiter, join, resolve } from "node:path";
import { type Ack, parseServerMessage } from "@flightdeck/protocol";
import {
  assertCheckGuardActive,
  assertNoRefusedChecks,
  installCheckGuard,
} from "./test/check-guard.ts";
import { assertNoClaudeCalls, installClaudeGuard } from "./test/claude-guard.ts";
import { assertCliGuardActive, assertNoCliCalls, installCliGuard } from "./test/cli-guard.ts";
import { KEY_MARKER } from "./test/fake-ssh-tools.ts";
import { assertHomeGuard, installHomeGuard } from "./test/home-guard.ts";
import { realTempDir } from "./test/temp-dir.ts";

// The daemon gets this environment: neither the real `claude`, `gh` and `az` nor `~/.claude`.
const clis = installCliGuard();
const guard = installClaudeGuard();
const home = installHomeGuard();
const checks = installCheckGuard();
assertCliGuardActive(clis);
assertCheckGuardActive(checks);

const TIMEOUT_MS = 30_000;
const WIN = process.platform === "win32";
const ROOT = resolve(import.meta.dir, "..");
const BIN = join(ROOT, "apps/daemon/src/bin.ts");
const TOOLS = join(ROOT, "scripts/test/fake-ssh-tools.ts");

// Keys made for the smoke (the first is the one `ssh-keygen` printed this fingerprint for).
const KEY_VAULT =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPHyii7r5lIz9AQ/c2vlfTxoKQtFoDLtWtwxRY/fF9Fl";
const FINGERPRINT_VAULT = "SHA256:5gaKG0bjmxouPIYIwZp+MDQqiFMkPvsxoXDW7mFO1hw";
const blob = (text: string) => `ssh-ed25519 ${Buffer.from(text).toString("base64")}`;
const KEY_PASSWORD_HOST = blob("smoke-password-host-key-0123");
const KEY_CHANGED = blob("smoke-changed-host-key-0123456");
const PRIVATE_KEY = `-----BEGIN OPENSSH PRIVATE KEY-----\n${KEY_MARKER}\n-----END OPENSSH PRIVATE KEY-----`;
const SECRET = "smoke-password-from-the-vault";

let step = "preparar";
const log = (msg: string) => console.log(`  · ${msg}`);

async function until<T>(check: () => T | null | undefined | false, what: string): Promise<T> {
  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timeout: ${what}`);
    await Bun.sleep(50);
  }
}

class Client {
  private ws!: WebSocket;
  private acks = new Map<string, (ack: Ack) => void>();
  private seq = 0;
  /** What arrived as `terminal.data`, decoded, by terminal. */
  output = new Map<string, string>();
  exited = new Map<string, number>();
  asked: Array<Record<string, unknown>> = [];

  constructor(private readonly url: string) {}

  async open(token: string): Promise<void> {
    this.ws = new WebSocket(this.url);
    this.ws.addEventListener("message", (msg) => {
      const parsed = parseServerMessage(String(msg.data));
      if (parsed.type === "ack") this.acks.get(parsed.id)?.(parsed);
      else if (parsed.type === "ping")
        this.ws.send(JSON.stringify({ type: "pong", id: parsed.id }));
      else if (parsed.type === "terminal.data") {
        const text = Buffer.from(parsed.data, "base64").toString("utf8");
        this.output.set(parsed.terminalId, (this.output.get(parsed.terminalId) ?? "") + text);
      } else if (parsed.type === "terminal.exited")
        this.exited.set(parsed.terminalId, parsed.exitCode);
      else if (parsed.type === "askpass.request") this.asked.push(parsed);
    });
    await new Promise<void>((ok, fail) => {
      this.ws.addEventListener("open", () => ok(), { once: true });
      this.ws.addEventListener("error", () => fail(new Error("falha ao conectar")), {
        once: true,
      });
    });
    await this.call("hello", { token, client: "smoke-ssh" });
  }

  async call<T = unknown>(type: string, payload: unknown): Promise<T> {
    const id = String(++this.seq);
    const ack = new Promise<Ack>((ok) => this.acks.set(id, ok));
    this.ws.send(JSON.stringify({ id, type, payload }));
    const result = await Promise.race([
      ack,
      Bun.sleep(TIMEOUT_MS).then(() => {
        throw new Error(`timeout: ack de ${type}`);
      }),
    ]);
    if (!result.ok) throw new Error(`${type}: ${result.error.code} ${result.error.message}`);
    return result.data as T;
  }

  close(): void {
    this.ws.close();
  }
}

async function readListenUrl(stream: ReadableStream<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    const match = buffer.match(/listening on (ws:\/\/\S+)/);
    if (match?.[1]) return match[1];
  }
  throw new Error(`daemon saiu sem anunciar a porta: ${buffer}`);
}

/** A port nobody listens on: `flightdeckd askpass` finds the daemon by the port in the config. */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as { port: number }).port;
  await new Promise((ok) => server.close(ok));
  return port;
}

/** The fake tools, each a small wrapper that runs `fake-ssh-tools.ts` with bun. */
function installTools(bin: string): { ssh: string } {
  mkdirSync(bin, { recursive: true });
  const tools = ["ssh", "ssh-keyscan", ...(WIN ? [] : ["ssh-agent", "ssh-add"])];
  const mode: Record<string, string> = {
    ssh: "ssh",
    "ssh-keyscan": "keyscan",
    "ssh-agent": "agent",
    "ssh-add": "add",
  };
  for (const name of tools) {
    const call = `"${process.execPath}" "${TOOLS}" ${mode[name]}`;
    if (WIN) {
      writeFileSync(join(bin, `${name}.cmd`), `@echo off\r\n${call} %*\r\n`);
    } else {
      writeFileSync(join(bin, name), `#!/bin/sh\nexec ${call} "$@"\n`);
      chmodSync(join(bin, name), 0o755);
    }
  }
  return { ssh: join(bin, WIN ? "ssh.cmd" : "ssh") };
}

const fingerprintOf = (key: string) =>
  `SHA256:${createHash("sha256")
    .update(Buffer.from(key.split(" ")[1] ?? "", "base64"))
    .digest("base64")
    .replace(/=+$/, "")}`;

interface FakeCall {
  tool: string;
  argv?: string[];
  pid?: number;
  sock?: string;
}

function readLog(file: string): FakeCall[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as FakeCall);
}

async function run(work: string): Promise<void> {
  // The ~/.ssh/config the import reads: under the home guard, never the user's.
  const sshHome = join(home.dir, ".ssh");
  mkdirSync(sshHome, { recursive: true });
  writeFileSync(
    join(sshHome, "config"),
    [
      "Host smoke-vault",
      "  HostName vault.example.test",
      "  User deploy",
      "  Port 2200",
      "  IdentityFile ~/.ssh/smoke_vault",
      "",
      "Host smoke-pw",
      "  HostName pw.example.test",
      "  User me",
      "",
      "Host *",
      "  ServerAliveInterval 30",
      "",
    ].join("\n"),
  );
  const keysFile = join(work, "server-keys.json");
  const keys: Record<string, string> = {
    "vault.example.test": KEY_VAULT,
    "pw.example.test": KEY_PASSWORD_HOST,
  };
  const publishKeys = () => writeFileSync(keysFile, JSON.stringify(keys));
  publishKeys();
  const fakeLog = join(work, "fake.log");
  const bin = join(work, "bin");
  const tools = installTools(bin);

  const token = crypto.randomUUID().replaceAll("-", "");
  const port = await freePort();
  const configPath = join(work, "config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      hostName: "smoke-ssh",
      port,
      token,
      dataDir: join(work, "data"),
      allowedRoots: [work],
      runtime: "fake",
      hooks: { port: 0 },
      ssh: { path: tools.ssh },
    }),
  );

  step = "subir daemon";
  const daemon = Bun.spawn(
    [process.execPath, "run", BIN, "start", "--config", configPath, "--runtime", "fake"],
    {
      env: {
        ...process.env,
        PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
        FD_FAKE_KEYS: keysFile,
        FD_FAKE_LOG: fakeLog,
        FD_FAKE_PASSWORD_SHA256: createHash("sha256").update(SECRET).digest("hex"),
      },
      stdout: "pipe",
      stderr: "inherit",
    },
  );
  try {
    const url = await readListenUrl(daemon.stdout);
    log(`daemon em ${url}`);
    const client = new Client(url);
    await client.open(token);

    step = "importar o ssh config";
    const preview = await client.call<{
      entries: Array<{ alias: string; port: number; identityFile: string | null }>;
    }>("ssh.import.preview", {});
    const aliases = preview.entries.map((e) => e.alias);
    if (aliases.join(",") !== "smoke-vault,smoke-pw") {
      throw new Error(`a prévia devia ter os dois nomes concretos: ${aliases.join(",")}`);
    }
    if (
      preview.entries[0]?.port !== 2200 ||
      preview.entries[0]?.identityFile !== "~/.ssh/smoke_vault"
    ) {
      throw new Error(`a prévia leu mal o primeiro: ${JSON.stringify(preview.entries[0])}`);
    }
    const applied = await client.call<{
      created: Array<{ id: string; name: string }>;
      skipped: unknown[];
    }>("ssh.import.apply", { aliases });
    if (applied.created.length !== 2 || applied.skipped.length !== 0) {
      throw new Error(`a importação devia criar os dois: ${JSON.stringify(applied)}`);
    }
    log("config importado: smoke-vault e smoke-pw (o curinga não virou destino)");
    const vault = applied.created.find((t) => t.name === "smoke-vault");
    const pw = applied.created.find((t) => t.name === "smoke-pw");
    if (!vault || !pw) throw new Error("faltou um destino importado");
    await client.call("ssh.save", {
      id: vault.id,
      name: "smoke-vault",
      host: "vault.example.test",
      port: 2200,
      user: "deploy",
      auth: "vault-key",
      secretRef: "chave-do-cofre",
    });
    await client.call("ssh.save", {
      id: pw.id,
      name: "smoke-pw",
      host: "pw.example.test",
      user: "me",
      auth: "password",
      secretRef: "senha-do-cofre",
    });

    step = "primeira conexão pede confirmação";
    const refused = await client
      .call("ssh.connect", { targetId: vault.id, cols: 100, rows: 30, privateKey: PRIVATE_KEY })
      .then(() => "conectou")
      .catch((error: Error) => error.message);
    if (!refused.includes("hostkey_unconfirmed")) {
      throw new Error(`devia pedir a confirmação da chave: ${refused}`);
    }
    if (readLog(fakeLog).some((e) => e.tool === "ssh"))
      throw new Error("o ssh rodou sem confirmação");
    const check = await client.call<{ status: string; fingerprint: string }>("ssh.hostkey.check", {
      targetId: vault.id,
    });
    if (check.status !== "unknown" || check.fingerprint !== FINGERPRINT_VAULT) {
      throw new Error(`fingerprint inesperado: ${JSON.stringify(check)}`);
    }
    await client.call("ssh.hostkey.confirm", {
      targetId: vault.id,
      fingerprint: check.fingerprint,
    });
    log(`fingerprint ${check.fingerprint} mostrado e confirmado`);

    step = "conectar com vault-key";
    const opened = await client.call<{ terminalId: string; command: string }>("ssh.connect", {
      targetId: vault.id,
      cols: 100,
      rows: 30,
      privateKey: PRIVATE_KEY,
    });
    await client.call("terminal.attach", { terminalId: opened.terminalId });
    await until(() => client.exited.get(opened.terminalId) !== undefined, "o ssh falso terminar");
    const output = client.output.get(opened.terminalId) ?? "";
    const wanted = WIN ? "KEY-FILE-OK" : "AGENT-OK";
    if (!output.includes(wanted) || !output.includes("FAKE-SSH-CONNECTED")) {
      throw new Error(`o ssh devia ter recebido a chave (${wanted}): ${output.slice(0, 300)}`);
    }
    const ssh = readLog(fakeLog).filter((e) => e.tool === "ssh");
    const argv: string[] = ssh[0]?.argv ?? [];
    const joined = argv.join(" ");
    for (const part of [
      "BatchMode=no",
      "StrictHostKeyChecking=yes",
      WIN ? "IdentitiesOnly=yes" : "IdentitiesOnly=no",
    ]) {
      if (!joined.includes(part)) throw new Error(`faltou ${part} no argv: ${joined}`);
    }
    if (argv.at(-2) !== "--" || argv.at(-1) !== "deploy@vault.example.test") {
      throw new Error(`o destino devia vir depois de --: ${joined}`);
    }
    if (joined.includes(KEY_MARKER) || output.includes(KEY_MARKER)) {
      throw new Error("a chave privada apareceu no argv ou na saída");
    }
    log(`o ssh falso recebeu a chave (${wanted}) e o argv é uma lista com o destino depois de --`);

    step = "a chave sumiu";
    if (WIN) {
      const keysDir = join(work, "data", "ssh", "keys");
      const left = existsSync(keysDir) ? readdirSync(keysDir) : [];
      if (left.length > 0) throw new Error(`sobrou arquivo de chave: ${left.join(",")}`);
      log("o arquivo temporário da chave foi apagado");
    } else {
      const agent = readLog(fakeLog).find((e) => e.tool === "agent");
      if (!agent) throw new Error("o ssh-agent da conexão não subiu");
      await until(() => {
        try {
          process.kill(agent.pid as number, 0);
          return false;
        } catch {
          return true;
        }
      }, "o ssh-agent da conexão encerrar");
      if (existsSync(agent.sock as string)) throw new Error("o socket do agent sobrou");
      log("o ssh-agent da conexão foi encerrado");
    }

    step = "senha pelo askpass";
    const pwCheck = await client.call<{ fingerprint: string }>("ssh.hostkey.check", {
      targetId: pw.id,
    });
    await client.call("ssh.hostkey.confirm", { targetId: pw.id, fingerprint: pwCheck.fingerprint });
    await client.call("askpass.watch", {});
    const pwTerminal = await client.call<{ terminalId: string }>("ssh.connect", {
      targetId: pw.id,
      cols: 100,
      rows: 30,
    });
    await client.call("terminal.attach", { terminalId: pwTerminal.terminalId });
    const request = await until(() => client.asked[0], "o pedido de senha chegar ao app");
    if (request.kind !== "password" || request.secretRef !== "senha-do-cofre") {
      throw new Error(`pedido inesperado: ${JSON.stringify(request)}`);
    }
    await client.call("askpass.answer", { requestId: request.requestId, secret: SECRET });
    await until(
      () => client.exited.get(pwTerminal.terminalId) !== undefined,
      "o ssh falso terminar",
    );
    const pwOutput = client.output.get(pwTerminal.terminalId) ?? "";
    if (!pwOutput.includes("PASSWORD-OK")) {
      throw new Error(`o helper devia ter devolvido a senha: ${pwOutput.slice(0, 300)}`);
    }
    const pwArgv = (readLog(fakeLog).filter((e) => e.tool === "ssh")[1]?.argv ?? []).join(" ");
    if (pwArgv.includes(SECRET) || pwOutput.includes(SECRET)) {
      throw new Error("a senha apareceu no argv ou na saída");
    }
    log("a senha veio do app pelo flightdeckd askpass, sem passar por argv nem pela saída");

    step = "fingerprint diferente bloqueia";
    keys["vault.example.test"] = KEY_CHANGED;
    publishKeys();
    const before = readLog(fakeLog).filter((e) => e.tool === "ssh").length;
    const blocked = await client
      .call("ssh.connect", { targetId: vault.id, cols: 100, rows: 30, privateKey: PRIVATE_KEY })
      .then(() => "conectou")
      .catch((error: Error) => error.message);
    if (
      !blocked.includes("hostkey_changed") ||
      !blocked.includes(FINGERPRINT_VAULT) ||
      !blocked.includes(fingerprintOf(KEY_CHANGED))
    ) {
      throw new Error(`devia bloquear mostrando os dois fingerprints: ${blocked}`);
    }
    if (readLog(fakeLog).filter((e) => e.tool === "ssh").length !== before) {
      throw new Error("o ssh rodou com a chave trocada");
    }
    log("a chave trocada foi bloqueada, com o fingerprint antigo e o novo");
    client.close();
  } finally {
    daemon.kill();
    await daemon.exited;
  }
}

// The real path: on the GitHub runner TEMP is an 8.3 name that the daemon resolves.
const work = realTempDir("flightdeck-smoke-ssh-");
let code = 1;
try {
  await run(work);
  step = "travas";
  assertNoClaudeCalls(guard);
  assertNoCliCalls(clis);
  assertHomeGuard(home);
  assertNoRefusedChecks(checks);
  console.log("SMOKE SSH OK");
  code = 0;
} catch (error) {
  console.error(
    `SMOKE SSH FAIL no passo "${step}": ${error instanceof Error ? error.message : String(error)}`,
  );
} finally {
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {
    // SQLite files may stay locked on Windows for a moment; a leftover temp dir is fine.
  }
}
process.exit(code);
