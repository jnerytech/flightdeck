import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DaemonManifest } from "@flightdeck/protocol";
import { signForTest, TEST_PUBLIC_KEY } from "../../../scripts/test/minisign.ts";
import { startServer } from "../src/server.ts";
import { type ServiceContext, systemdUnit, windowsTaskXml } from "../src/service.ts";
import { assetKey, DaemonUpdater } from "../src/updates/apply.ts";
import { newManager, tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "update-apply-token-0123456789";
const BINARY = new TextEncoder().encode("flightdeckd 0.9.0 binário de teste");
const sha256 = (data: Uint8Array) => new Bun.CryptoHasher("sha256").update(data).digest("hex");

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** Serves the binary of each platform; the manifest lists them, signed by the test key. */
function release(served: Uint8Array = BINARY, signed: Uint8Array = BINARY) {
  const server = Bun.serve({ port: 0, fetch: () => new Response(served) });
  cleanups.push(() => server.stop(true));
  const asset = (name: string) => ({
    url: `http://127.0.0.1:${server.port}/${name}`,
    sha256: sha256(signed),
    signature: signForTest(signed),
  });
  const manifest: DaemonManifest = {
    version: "0.9.0",
    protocol: 1,
    assets: {
      "windows-x64": asset("flightdeckd-windows-x64.exe"),
      "linux-x64": asset("flightdeckd-linux-x64"),
      "linux-arm64": asset("flightdeckd-linux-arm64"),
    },
  };
  return manifest;
}

/** A service context that records commands; the service is installed when `installed` is set. */
function service(platform: "win32" | "linux", installed: boolean) {
  const calls: string[][] = [];
  const exe =
    platform === "win32" ? "C:\\fd\\flightdeckd.exe" : "/home/dev/.flightdeck/bin/flightdeckd";
  const ctx: ServiceContext = {
    platform,
    home: tempDir(),
    user: platform === "win32" ? "PC\\dev" : "dev",
    command: [],
    systemRoot: "C:\\Windows",
    tempDir: tempDir(),
    dryRun: false,
    exec: async (cmd) => {
      calls.push(cmd);
      const query = cmd[1] === "/Query" || cmd[2] === "cat";
      if (query && !installed) return { code: 1, stdout: "" };
      if (query) {
        const stdout =
          platform === "win32"
            ? windowsTaskXml([exe], { user: "PC\\dev", systemRoot: "C:\\Windows" })
            : systemdUnit([exe]);
        return { code: 0, stdout };
      }
      return { code: 0, stdout: "" };
    },
    writeFile: () => {},
    removeFile: () => {},
    which: () => null,
  };
  return { ctx, calls };
}

function updater(
  manifest: DaemonManifest | null,
  opts: { platform?: "win32" | "linux"; arch?: string; installed?: boolean } = {},
) {
  const platform = opts.platform ?? "linux";
  const svc = service(platform, opts.installed ?? true);
  const dataDir = tempDir();
  const updates = new DaemonUpdater({
    manifest: () => manifest,
    dataDir,
    ctx: svc.ctx,
    publicKey: TEST_PUBLIC_KEY,
    platform,
    arch: opts.arch ?? "x64",
  });
  const files = () =>
    existsSync(join(dataDir, "updates")) ? readdirSync(join(dataDir, "updates")) : [];
  return { updates, calls: svc.calls, dataDir, files };
}

/** The error code (or "ok") of an apply. */
async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? (error as Error).message;
  }
}

describe("daemon-update-apply", () => {
  test("o asset vem do sistema e da arquitetura do host", () => {
    expect(assetKey("win32", "x64")).toBe("windows-x64");
    expect(assetKey("linux", "x64")).toBe("linux-x64");
    expect(assetKey("linux", "arm64")).toBe("linux-arm64");
    expect(() => assetKey("darwin", "arm64")).toThrow("sem binário do daemon para darwin-arm64");
  });

  test("Linux: baixa, confere sha256 e assinatura e dispara o update por systemd-run, fora do serviço", async () => {
    const { updates, calls, dataDir, files } = updater(release());
    expect(await code(updates.apply(true))).toBe("ok");
    const file = join(dataDir, "updates", "flightdeckd-0.9.0");
    expect(files()).toEqual(["flightdeckd-0.9.0"]);
    expect(readFileSync(file)).toEqual(Buffer.from(BINARY));
    expect(calls.at(-1)).toEqual([
      "systemd-run",
      "--user",
      "--collect",
      "--unit",
      "flightdeckd-update",
      file,
      "update",
      "--from",
      file,
    ]);
  });

  test("Windows: tarefa de execução única Flightdeck\\update, que roda o update e se apaga", async () => {
    const { updates, calls, dataDir } = updater(release(), { platform: "win32" });
    expect(await code(updates.apply(true))).toBe("ok");
    const file = join(dataDir, "updates", "flightdeckd-0.9.0.exe");
    const create = calls.find((c) => c[1] === "/Create");
    expect(create?.slice(0, 4)).toEqual(["schtasks", "/Create", "/TN", "Flightdeck\\update"]);
    const run = create?.[create.indexOf("/TR") + 1] ?? "";
    expect(run).toContain(`"${file}" update --from "${file}"`);
    expect(run).toContain("schtasks /Delete /TN Flightdeck\\update /F");
    expect(calls.at(-1)).toEqual(["schtasks", "/Run", "/TN", "Flightdeck\\update"]);
  });

  test("recusa sem confirm, sem manifesto verificado e sem asset para o sistema", async () => {
    expect(await code(updater(release()).updates.apply(false))).toBe("invalid_state");
    expect(await code(updater(null).updates.apply(true))).toBe("invalid_state");
    const darwin = updater(release(), { arch: "ppc" });
    expect(await code(darwin.updates.apply(true))).toBe("invalid_state");
  });

  test("verificação que falha apaga o arquivo e devolve update_verification_failed", async () => {
    const tampered = new Uint8Array(BINARY);
    tampered[0] = (tampered[0] as number) ^ 1;
    // sha256 that does not match what is served.
    const badHash = updater(release(tampered, BINARY));
    expect(await code(badHash.updates.apply(true))).toBe("update_verification_failed");
    expect(badHash.files()).toEqual([]);
    // A matching sha256 but a signature of another file.
    const manifest = release();
    for (const asset of Object.values(manifest.assets)) asset.signature = signForTest(tampered);
    const badSig = updater(manifest);
    expect(await code(badSig.updates.apply(true))).toBe("update_verification_failed");
    expect(badSig.files()).toEqual([]);
    expect(badSig.calls.some((c) => c[0] === "systemd-run")).toBe(false);
  });

  test("sem serviço: update_needs_service, sem disparar nada nem deixar arquivo", async () => {
    const { updates, calls, files } = updater(release(), { installed: false });
    expect(await code(updates.apply(true))).toBe("update_needs_service");
    expect(calls.some((c) => c[0] === "systemd-run")).toBe(false);
    expect(files()).toEqual([]);
  });

  test("protocolo: daemon.update.apply responde started; sem atualizador, invalid_state", async () => {
    const { manager } = newManager();
    const base = { manager, hostName: "h", bind: "127.0.0.1", port: 0, token: TOKEN };
    const { updates } = updater(release());
    const server = startServer({ ...base, allowedRoots: [], updater: updates });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    expect(await client.data("daemon.update.apply", { confirm: true })).toEqual({ started: true });
    expect(await client.request("daemon.update.apply", {})).toMatchObject({
      ok: false,
      error: { code: "invalid_state" },
    });
    const plain = startServer({ ...base, allowedRoots: [] });
    cleanups.push(() => plain.stop());
    const other = new FrameClient(plain.url);
    cleanups.push(() => other.close());
    await other.request("hello", { token: TOKEN, client: "t" });
    expect(await other.request("daemon.update.apply", { confirm: true })).toMatchObject({
      ok: false,
      error: { code: "invalid_state" },
    });
  });
});
