import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { collectReleaseAssets, readProductVersions, tagProblems } from "../lib/release.ts";

const ROOT = resolve(import.meta.dir, "../..");
const SAME = { "packages/protocol": "0.7.0", "apps/daemon": "0.7.0", "apps/desktop": "0.7.0" };

const sha256 = (data: string) => new Bun.CryptoHasher("sha256").update(data).digest("hex");

/** A checkout after `build:daemon` and `tauri build --bundles nsis,msi`, with `files` in it. */
function built(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "fd-release-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

const BUNDLE = "apps/desktop/src-tauri/target/release/bundle";
const COMPLETE = {
  "dist/flightdeckd-windows-x64.exe": "win",
  "dist/flightdeckd-linux-x64": "linux",
  "dist/flightdeckd-linux-arm64": "arm",
  [`${BUNDLE}/nsis/Flightdeck_0.7.0_x64-setup.exe`]: "nsis",
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

  test("junta o instalador, o msi e os três daemons numa pasta, com o SHA256SUMS", () => {
    const root = built(COMPLETE);
    const out = join(root, "release");
    const assets = collectReleaseAssets(root, "0.7.0", out);
    const names = [
      "Flightdeck_0.7.0_x64-setup.exe",
      "Flightdeck_0.7.0_x64_en-US.msi",
      "flightdeckd-linux-arm64",
      "flightdeckd-linux-x64",
      "flightdeckd-windows-x64.exe",
    ];
    expect(assets.map((a) => a.name)).toEqual(names);
    expect(readdirSync(out).sort()).toEqual([...names, "SHA256SUMS"].sort());
    expect(readFileSync(join(out, "flightdeckd-linux-arm64"), "utf8")).toBe("arm");
    // The format `sha256sum -c` reads: hash, two spaces, name.
    expect(readFileSync(join(out, "SHA256SUMS"), "utf8")).toBe(
      ["nsis", "msi", "arm", "linux", "win"]
        .map((content, i) => `${sha256(content)}  ${names[i]}\n`)
        .join(""),
    );
  });

  test("falta de arquivo, instalador de outra versão ou dois instaladores param a release", () => {
    const { "dist/flightdeckd-linux-arm64": _arm, ...withoutArm } = COMPLETE;
    const fail = (files: Record<string, string>) => {
      try {
        collectReleaseAssets(built(files), "0.7.0", join(tmpdir(), "nunca"));
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
    expect(existsSync(join(tmpdir(), "nunca", "SHA256SUMS"))).toBe(false);
  });
});
