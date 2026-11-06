import { describe, expect, test } from "bun:test";
import { credential } from "../src/permissions/risk.ts";
import { CREDENTIAL_READS } from "../src/runtime/opencode-config.ts";

/** An OpenCode glob as a regular expression: `*` stands for any text, slashes included. */
const matches = (glob: string, path: string) =>
  new RegExp(`^${glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*")}$`).test(path);

/** Paths that hold a secret, written by hand: the classifier and OpenCode must both know each (issue #449). */
const SECRETS = [
  "/home/u/.ssh/id_rsa",
  "/home/u/.aws/credentials",
  "/home/u/.config/gh/hosts.yml",
  "/home/u/.claude/.credentials.json",
  "/home/u/.claude.json",
  "/home/u/.flightdeck/config.json",
  "/home/u/.npmrc",
  "/home/u/.netrc",
  "/home/u/.pypirc",
  "/home/u/.git-credentials",
  "/home/u/.vault-token",
  "/home/u/.psql_history",
  "/home/u/.bash_history",
  "/home/u/.ssh/authorized_keys",
  "/home/u/.kube/config",
  "/home/u/.gnupg/pubring.kbx",
  "/home/u/.azure/accessTokens.json",
  "/home/u/.docker/config.json",
  "/home/u/.config/gcloud/credentials.db",
  "/home/u/.config/rclone/rclone.conf",
  "/home/u/.cargo/credentials.toml",
  "/home/u/.m2/settings.xml",
  "/home/u/.terraform.d/credentials.tfrc.json",
  "/p/.env",
  "/p/.env.local",
  "/p/prod.env",
  "/p/server.pem",
  "/p/server.key",
  "/p/id_ed25519",
  "/p/client.pfx",
  "/p/client.p12",
  "/p/vpn.ovpn",
  "/p/infra/terraform.tfstate",
];

describe("secret paths: the classifier and OpenCode's read rules know the same ones (issue #449)", () => {
  test("every secret path of the list is a credential for the classifier", () => {
    for (const path of SECRETS) expect(credential(path), `${path} is a credential`).toBe(true);
  });

  test("every secret path of the list is asked about by an OpenCode read rule", () => {
    for (const path of SECRETS) {
      expect(
        CREDENTIAL_READS.some((glob) => matches(glob, path)),
        `a read rule covers ${path}`,
      ).toBe(true);
    }
  });

  test("a path an OpenCode read rule asks about is a credential for the classifier", () => {
    for (const glob of CREDENTIAL_READS) {
      const sample = glob.replace(/^\*\//, "/home/u/").replaceAll("*", "x");
      expect(credential(sample), `${glob} (as ${sample}) is a credential`).toBe(true);
    }
  });

  test("an ordinary project path is neither", () => {
    for (const path of ["/p/src/app.ts", "/p/README.md", "/p/docker/Dockerfile", "/p/env.ts"]) {
      expect(credential(path), `${path} is not a credential`).toBe(false);
      expect(
        CREDENTIAL_READS.some((glob) => matches(glob, path)),
        `no read rule covers ${path}`,
      ).toBe(false);
    }
  });
});
