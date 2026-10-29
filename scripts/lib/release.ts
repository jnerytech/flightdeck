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
import { PROTOCOL_VERSION } from "@flightdeck/protocol";
import { parsePublicKey } from "../../apps/daemon/src/updates/signature.ts";

/** The packages that carry the product version (`tauri.conf.json` reads the desktop's). */
const PACKAGES = ["packages/protocol", "apps/daemon", "apps/desktop"] as const;

/** `build:daemon` outputs. */
export const DAEMONS = [
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

/** Where the release files are downloaded from, per tag; `latest` always points to the newest. */
const REPO = "jnerytech/flightdeck";
const downloads = (version: string) => `https://github.com/${REPO}/releases/download/v${version}`;
const LATEST_JSON = `https://github.com/${REPO}/releases/latest/download/latest.json`;

/** `daemon-latest.json` key of each daemon binary. */
const DAEMON_PLATFORMS: Record<string, string> = {
  "dist/flightdeckd-windows-x64.exe": "windows-x64",
  "dist/flightdeckd-linux-x64": "linux-x64",
  "dist/flightdeckd-linux-arm64": "linux-arm64",
};

const sha256 = (data: Uint8Array) => new Bun.CryptoHasher("sha256").update(data).digest("hex");

/** The `.sig` next to `path`, as text; a missing one stops the release. */
function signatureOf(root: string, path: string): string {
  const sig = `${path}.sig`;
  if (!existsSync(join(root, sig))) throw new Error(`falta a assinatura ${sig}`);
  return readFileSync(join(root, sig), "utf8").trim();
}

export interface ReleaseOptions {
  /** `pub_date` of the app manifest. */
  now?: Date;
  /** Protocol the daemons of this release speak, for `daemon-latest.json`. */
  protocol?: number;
}

/**
 * Copies the release files into `out`: the installers, the daemons, the signature of the NSIS
 * installer and of each daemon, and the two manifests (`latest.json` for the app's updater,
 * `daemon-latest.json` for the daemons). Writes `SHA256SUMS` over all of them (`sha256sum -c`
 * format). Checks everything before copying anything: a missing file stops the release.
 */
export function collectReleaseAssets(
  root: string,
  version: string,
  out: string,
  opts: ReleaseOptions = {},
): ReleaseAsset[] {
  const missing = DAEMONS.filter((path) => !existsSync(join(root, path)));
  if (missing.length > 0) throw new Error(`faltam arquivos: ${missing.join(", ")}`);
  const nsis = installer(root, "nsis", ".exe", "instalador NSIS", version);
  const msi = installer(root, "msi", ".msi", ".msi", version);
  const nsisSig = signatureOf(root, nsis.slice(root.length + 1));
  const daemonSigs = DAEMONS.map((path) => signatureOf(root, path));

  const base = downloads(version);
  const app = {
    version,
    notes: `Flightdeck ${version}: https://github.com/${REPO}/releases/tag/v${version}`,
    pub_date: (opts.now ?? new Date()).toISOString(),
    platforms: { "windows-x86_64": { signature: nsisSig, url: `${base}/${basename(nsis)}` } },
  };
  const daemon = {
    version,
    protocol: opts.protocol ?? PROTOCOL_VERSION,
    assets: Object.fromEntries(
      DAEMONS.map((path, i) => [
        DAEMON_PLATFORMS[path],
        {
          url: `${base}/${basename(path)}`,
          sha256: sha256(readFileSync(join(root, path))),
          signature: daemonSigs[i],
        },
      ]),
    ),
  };

  mkdirSync(out, { recursive: true });
  const copied = [nsis, `${nsis}.sig`, msi, ...DAEMONS.flatMap((p) => [p, `${p}.sig`])].map(
    (source) => {
      const from = source.startsWith(root) ? source : join(root, source);
      const path = join(out, basename(source));
      copyFileSync(from, path);
      return { name: basename(source), path };
    },
  );
  const manifests = [
    ["latest.json", app],
    ["daemon-latest.json", daemon],
  ].map(([name, content]) => {
    const path = join(out, name as string);
    writeFileSync(path, `${JSON.stringify(content, null, 2)}\n`);
    return { name: name as string, path };
  });
  const assets = [...copied, ...manifests].sort((a, b) => (a.name < b.name ? -1 : 1));
  const sums = assets.map(({ name, path }) => `${sha256(readFileSync(path))}  ${name}\n`);
  writeFileSync(join(out, "SHA256SUMS"), sums.join(""));
  return assets;
}

/**
 * What `tauri build --config` merges for a release: the updater artifacts (the installer's
 * `.sig`), the public key and the endpoint of `latest.json`. Refuses anything that is not a key,
 * the placeholder above all.
 */
export function tauriReleaseConfig(publicKey: string) {
  try {
    parsePublicKey(publicKey);
  } catch {
    throw new Error(
      "release/flightdeck.pub não é uma chave pública válida: gere o par com `tauri signer generate` e ponha o .pub ali",
    );
  }
  return {
    bundle: { createUpdaterArtifacts: true },
    plugins: { updater: { pubkey: publicKey.trim(), endpoints: [LATEST_JSON] } },
  };
}
