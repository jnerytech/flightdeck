/** What a release publishes: the Windows installers of the app, the daemons and their checksums. */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";

/** The packages that carry the product version (`tauri.conf.json` reads the desktop's). */
const PACKAGES = ["packages/protocol", "apps/daemon", "apps/desktop"] as const;

/** `build:daemon` outputs. */
const DAEMONS = [
  "dist/flightdeckd-windows-x64.exe",
  "dist/flightdeckd-linux-x64",
  "dist/flightdeckd-linux-arm64",
];

/** Where `tauri build --bundles nsis,msi` leaves the installers. */
const BUNDLE = "apps/desktop/src-tauri/target/release/bundle";

export interface ReleaseAsset {
  name: string;
  path: string;
}

/** Why `tag` cannot be released: not `v<x.y.z>`, or some package is at another version. */
export function tagProblems(tag: string, versions: Record<string, string>): string[] {
  const version = /^v(\d+\.\d+\.\d+)$/.exec(tag)?.[1];
  if (!version) return [`a tag "${tag}" não tem a forma v<x.y.z>`];
  return Object.entries(versions)
    .filter(([, current]) => current !== version)
    .map(([pkg, current]) => `${pkg} está em ${current}, a tag pede ${version}`);
}

export function readProductVersions(root: string): Record<string, string> {
  return Object.fromEntries(
    PACKAGES.map((pkg) => {
      const json = JSON.parse(readFileSync(join(root, pkg, "package.json"), "utf8"));
      return [pkg, json.version as string];
    }),
  );
}

/** The one installer of `version` in `dir` whose name ends with `ext`. */
function installer(root: string, dir: string, ext: string, kind: string, version: string) {
  const path = join(root, BUNDLE, dir);
  const found = (existsSync(path) ? readdirSync(path) : []).filter(
    (name) => name.endsWith(ext) && name.includes(`_${version}_`),
  );
  if (found.length === 0)
    throw new Error(`nenhum ${kind} da versão ${version} em ${BUNDLE}/${dir}`);
  if (found.length > 1) {
    throw new Error(`mais de um ${kind} da versão ${version}: ${found.join(", ")}`);
  }
  return join(path, found[0] as string);
}

/**
 * Copies the release files into `out` and writes `SHA256SUMS` next to them (`sha256sum -c`
 * format). Checks everything before copying anything: a missing file stops the release.
 */
export function collectReleaseAssets(root: string, version: string, out: string): ReleaseAsset[] {
  const missing = DAEMONS.filter((path) => !existsSync(join(root, path)));
  if (missing.length > 0) throw new Error(`faltam arquivos: ${missing.join(", ")}`);
  const sources = [
    installer(root, "nsis", ".exe", "instalador NSIS", version),
    installer(root, "msi", ".msi", ".msi", version),
    ...DAEMONS.map((path) => join(root, path)),
  ];
  mkdirSync(out, { recursive: true });
  const assets = sources
    .map((source) => ({ source, name: basename(source) }))
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .map(({ source, name }) => {
      const path = join(out, name);
      copyFileSync(source, path);
      return { name, path };
    });
  const sums = assets.map(({ name, path }) => {
    const hash = new Bun.CryptoHasher("sha256").update(readFileSync(path)).digest("hex");
    return `${hash}  ${name}\n`;
  });
  writeFileSync(join(out, "SHA256SUMS"), sums.join(""));
  return assets;
}
