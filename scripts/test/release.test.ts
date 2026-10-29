import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  collectReleaseAssets,
  readProductVersions,
  tagProblems,
  tauriReleaseConfig,
} from "../lib/release.ts";
import { realTempDir } from "./temp-dir.ts";

const ROOT = resolve(import.meta.dir, "../..");
const SAME = { "packages/protocol": "0.7.0", "apps/daemon": "0.7.0", "apps/desktop": "0.7.0" };

const sha256 = (data: string) => new Bun.CryptoHasher("sha256").update(data).digest("hex");

/** A checkout after `build:daemon` and `tauri build --bundles nsis,msi`, with `files` in it. */
function built(files: Record<string, string>) {
  const root = realTempDir("fd-release-");
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

const BUNDLE = "apps/desktop/src-tauri/target/release/bundle";
/** A signed build: the NSIS installer and each daemon with its `.sig` (phase 9). */
const COMPLETE = {
  "dist/flightdeckd-windows-x64.exe": "win",
  "dist/flightdeckd-windows-x64.exe.sig": "sig-win",
  "dist/flightdeckd-linux-x64": "linux",
  "dist/flightdeckd-linux-x64.sig": "sig-linux",
  "dist/flightdeckd-linux-arm64": "arm",
  "dist/flightdeckd-linux-arm64.sig": "sig-arm",
  [`${BUNDLE}/nsis/Flightdeck_0.7.0_x64-setup.exe`]: "nsis",
  [`${BUNDLE}/nsis/Flightdeck_0.7.0_x64-setup.exe.sig`]: "sig-nsis",
  [`${BUNDLE}/msi/Flightdeck_0.7.0_x64_en-US.msi`]: "msi",
};

describe("release", () => {
  test("a tag é v<versão> e bate com a versão de todos os pacotes", () => {
    expect(tagProblems("v0.7.0", SAME)).toEqual([]);
    expect(tagProblems("0.7.0", SAME)).toEqual(['a tag "0.7.0" não tem a forma v<x.y.z>']);
    expect(tagProblems("v0.8.0", SAME)).toEqual([
      "packages/protocol está em 0.7.0, a tag pede 0.8.0",
      "apps/daemon está em 0.7.0, a tag pede 0.8.0",
      "apps/desktop está em 0.7.0, a tag pede 0.8.0",
    ]);
    expect(tagProblems("v0.7.0", { ...SAME, "apps/daemon": "0.6.0" })).toEqual([
      "apps/daemon está em 0.6.0, a tag pede 0.7.0",
    ]);
  });

  test("as versões do produto vêm dos package.json do protocolo, do daemon e do app", () => {
    const versions = readProductVersions(ROOT);
    expect(Object.keys(versions)).toEqual(["packages/protocol", "apps/daemon", "apps/desktop"]);
    const desktop = JSON.parse(readFileSync(join(ROOT, "apps/desktop/package.json"), "utf8"));
    expect(versions["apps/desktop"]).toBe(desktop.version);
  });

  test("junta o instalador, o msi, os três daemons, as assinaturas e os manifestos, com o SHA256SUMS", () => {
    const root = built(COMPLETE);
    const out = join(root, "release-assets");
    const assets = collectReleaseAssets(root, "0.7.0", out);
    const names = [
      "Flightdeck_0.7.0_x64-setup.exe",
      "Flightdeck_0.7.0_x64-setup.exe.sig",
      "Flightdeck_0.7.0_x64_en-US.msi",
      "daemon-latest.json",
      "flightdeckd-linux-arm64",
      "flightdeckd-linux-arm64.sig",
      "flightdeckd-linux-x64",
      "flightdeckd-linux-x64.sig",
      "flightdeckd-windows-x64.exe",
      "flightdeckd-windows-x64.exe.sig",
      "latest.json",
    ];
    expect(assets.map((a) => a.name)).toEqual(names);
    expect(readdirSync(out).sort()).toEqual([...names, "SHA256SUMS"].sort());
    expect(readFileSync(join(out, "flightdeckd-linux-arm64"), "utf8")).toBe("arm");
    // The format `sha256sum -c` reads: hash, two spaces, name; it covers signatures and manifests.
    expect(readFileSync(join(out, "SHA256SUMS"), "utf8")).toBe(
      names.map((name) => `${sha256(readFileSync(join(out, name), "utf8"))}  ${name}\n`).join(""),
    );
  });

  test("falta de arquivo, instalador de outra versão ou dois instaladores param a release", () => {
    // A fresh folder each run: a fixed one under tmpdir() outlives the run that created it.
    const never = join(realTempDir("fd-release-out-"), "nunca");
    const { "dist/flightdeckd-linux-arm64": _arm, ...withoutArm } = COMPLETE;
    const fail = (files: Record<string, string>) => {
      try {
        collectReleaseAssets(built(files), "0.7.0", never);
        return "juntou";
      } catch (error) {
        return (error as Error).message;
      }
    };
    expect(fail(withoutArm)).toContain("dist/flightdeckd-linux-arm64");
    const { [`${BUNDLE}/msi/Flightdeck_0.7.0_x64_en-US.msi`]: _msi, ...withoutMsi } = COMPLETE;
    expect(
      fail({ ...withoutMsi, [`${BUNDLE}/msi/Flightdeck_0.6.0_x64_en-US.msi`]: "velho" }),
    ).toContain("nenhum .msi da versão 0.7.0");
    expect(
      fail({ ...COMPLETE, [`${BUNDLE}/nsis/Flightdeck_0.7.0_x64-setup (1).exe`]: "outro" }),
    ).toContain("mais de um instalador NSIS da versão 0.7.0");
    expect(existsSync(join(never, "SHA256SUMS"))).toBe(false);
  });

  test("os manifestos do app e do daemon levam versão, URLs, sha256 e assinaturas", () => {
    const root = built(COMPLETE);
    const out = join(root, "release-assets");
    const now = new Date("2026-11-02T10:00:00.000Z");
    collectReleaseAssets(root, "0.7.0", out, { now, protocol: 3 });
    expect(
      existsSync(join(out, "latest.json")) && existsSync(join(out, "daemon-latest.json")),
    ).toBe(true);
    const download = "https://github.com/jnerytech/flightdeck/releases/download/v0.7.0";
    expect(JSON.parse(readFileSync(join(out, "latest.json"), "utf8"))).toEqual({
      version: "0.7.0",
      notes: "Flightdeck 0.7.0: https://github.com/jnerytech/flightdeck/releases/tag/v0.7.0",
      pub_date: "2026-11-02T10:00:00.000Z",
      platforms: {
        "windows-x86_64": {
          signature: "sig-nsis",
          url: `${download}/Flightdeck_0.7.0_x64-setup.exe`,
        },
      },
    });
    const asset = (file: string, content: string, signature: string) => ({
      url: `${download}/${file}`,
      sha256: sha256(content),
      signature,
    });
    expect(JSON.parse(readFileSync(join(out, "daemon-latest.json"), "utf8"))).toEqual({
      version: "0.7.0",
      protocol: 3,
      assets: {
        "windows-x64": asset("flightdeckd-windows-x64.exe", "win", "sig-win"),
        "linux-x64": asset("flightdeckd-linux-x64", "linux", "sig-linux"),
        "linux-arm64": asset("flightdeckd-linux-arm64", "arm", "sig-arm"),
      },
    });
  });

  test("falta de .sig do instalador ou de um daemon para a release", () => {
    const never = join(realTempDir("fd-release-out-"), "nunca");
    const fail = (files: Record<string, string>) => {
      try {
        collectReleaseAssets(built(files), "0.7.0", never);
        return "juntou";
      } catch (error) {
        return (error as Error).message;
      }
    };
    const { "dist/flightdeckd-linux-x64.sig": _sig, ...noDaemonSig } = COMPLETE;
    expect(fail(noDaemonSig)).toContain("dist/flightdeckd-linux-x64.sig");
    const { [`${BUNDLE}/nsis/Flightdeck_0.7.0_x64-setup.exe.sig`]: _nsis, ...noInstallerSig } =
      COMPLETE;
    expect(fail(noInstallerSig)).toContain("Flightdeck_0.7.0_x64-setup.exe.sig");
    expect(existsSync(never)).toBe(false);
  });

  test("config de build do app para a release: artefatos do updater, chave pública e endpoint", () => {
    const pub = readFileSync(
      join(ROOT, "apps/daemon/test/fixtures/release/test-signing.pub"),
      "utf8",
    );
    expect(tauriReleaseConfig(pub)).toEqual({
      bundle: { createUpdaterArtifacts: true },
      plugins: {
        updater: {
          pubkey: pub.trim(),
          endpoints: [
            "https://github.com/jnerytech/flightdeck/releases/latest/download/latest.json",
          ],
        },
      },
    });
    // A placeholder in place of the key stops the build with a clear message.
    expect(() => tauriReleaseConfig("PLACEHOLDER: a chave ainda não foi gerada\n")).toThrow(
      "release/flightdeck.pub não é uma chave pública válida",
    );
  });

  test("release/flightdeck.pub é a chave pública do projeto, diferente das chaves de teste", () => {
    const product = readFileSync(join(ROOT, "release/flightdeck.pub"), "utf8");
    let config: ReturnType<typeof tauriReleaseConfig> | string;
    try {
      config = tauriReleaseConfig(product);
    } catch (error) {
      config = (error as Error).message;
    }
    expect(config).toMatchObject({ plugins: { updater: { pubkey: product.trim() } } });
    for (const name of ["test-signing.pub", "tauri-signer.pub"]) {
      const test = readFileSync(join(ROOT, "apps/daemon/test/fixtures/release", name), "utf8");
      expect(test.trim()).not.toBe(product.trim());
    }
  });
});
