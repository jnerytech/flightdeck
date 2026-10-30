/**
 * Phase 9: `daemon.update.apply`. Downloads the binary of this host from the checked manifest,
 * checks its sha256 and the project's minisign signature, and hands it to `flightdeckd update`
 * (phase 7) started outside the service's process tree, so it survives the daemon stopping.
 */
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DaemonManifest } from "@flightdeck/protocol";
import { FlightdeckError } from "../errors.ts";
import { runChecked, type ServiceContext, serviceCommand } from "../service.ts";
import { updatePublicKey } from "./public-key.ts";
import { verifyMinisign } from "./signature.ts";

/** The one-shot task that runs the update on Windows; it deletes itself at the end. */
const UPDATE_TASK = "Flightdeck\\update";

/** The manifest key of the daemon binary for this OS and architecture. */
export function assetKey(platform: string, arch: string): string {
  let os: string | null = null;
  if (platform === "win32") os = "windows";
  else if (platform === "linux") os = "linux";
  if (!os || (arch !== "x64" && arch !== "arm64")) {
    throw new FlightdeckError("invalid_state", `sem binário do daemon para ${platform}-${arch}`);
  }
  return `${os}-${arch}`;
}

const sha256 = (data: Uint8Array) => new Bun.CryptoHasher("sha256").update(data).digest("hex");

export interface DaemonUpdaterOptions {
  /** The manifest of the last successful check. */
  manifest(): DaemonManifest | null;
  dataDir: string;
  ctx: ServiceContext;
  /** The project's key, embedded at build time; tests pass the test key. */
  publicKey?: string;
  platform?: string;
  arch?: string;
  fetch?: (url: string) => Promise<Response>;
}

export class DaemonUpdater {
  constructor(private readonly opts: DaemonUpdaterOptions) {}

  async apply(confirm: boolean): Promise<{ started: true }> {
    if (!confirm)
      throw new FlightdeckError("invalid_state", "atualizar o daemon pede confirm: true");
    const manifest = this.opts.manifest();
    if (!manifest) {
      throw new FlightdeckError("invalid_state", "o daemon ainda não verificou o manifesto");
    }
    const platform = this.opts.platform ?? process.platform;
    const key = assetKey(platform, this.opts.arch ?? process.arch);
    const asset = manifest.assets[key];
    if (!asset) {
      throw new FlightdeckError(
        "invalid_state",
        `o manifesto ${manifest.version} não tem binário para ${key}`,
      );
    }
    const dir = join(this.opts.dataDir, "updates");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `flightdeckd-${manifest.version}${platform === "win32" ? ".exe" : ""}`);
    await this.download(asset, file);
    if (!(await serviceCommand(this.opts.ctx))) {
      rmSync(file, { force: true });
      throw new FlightdeckError(
        "update_needs_service",
        "o daemon não roda como serviço: atualize no host com flightdeckd update --from <binário novo>",
      );
    }
    await this.start(platform, file);
    return { started: true };
  }

  /** Writes the file only once it is verified: a failure leaves nothing in `updates/`. */
  private async download(asset: DaemonManifest["assets"][string], file: string): Promise<void> {
    try {
      const response = await (this.opts.fetch ?? fetch)(asset.url);
      if (!response.ok) throw new Error(`o download respondeu HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (sha256(bytes) !== asset.sha256) {
        throw new Error("o sha256 do arquivo baixado não confere com o manifesto");
      }
      verifyMinisign(bytes, asset.signature, this.opts.publicKey ?? updatePublicKey());
      writeFileSync(file, bytes);
      chmodSync(file, 0o755);
    } catch (error) {
      throw new FlightdeckError("update_verification_failed", (error as Error).message);
    }
  }

  /** `flightdeckd update --from <file>` outside the service, so it outlives the daemon. */
  private async start(platform: string, file: string): Promise<void> {
    const { ctx } = this.opts;
    if (platform !== "win32") {
      const cmd = ["systemd-run", "--user", "--collect", "--unit", "flightdeckd-update"];
      await runChecked(ctx, [...cmd, file, "update", "--from", file]);
      return;
    }
    const run = `cmd /c ""${file}" update --from "${file}" & schtasks /Delete /TN ${UPDATE_TASK} /F"`;
    const once = ["/SC", "ONCE", "/ST", "00:00", "/F"];
    await runChecked(ctx, ["schtasks", "/Create", "/TN", UPDATE_TASK, "/TR", run, ...once]);
    await runChecked(ctx, ["schtasks", "/Run", "/TN", UPDATE_TASK]);
  }
}
