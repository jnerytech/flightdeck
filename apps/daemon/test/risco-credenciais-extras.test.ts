import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { credential, RiskClassifier } from "../src/permissions/risk.ts";
import { type ClassifyCall, type PathKind, ruleLevel } from "../src/permissions/rule-risk.ts";

const HOME = resolve("/casa/u");
const CWD = resolve("/trabalho/proj");
const risk = new RiskClassifier({ allowedRoots: [], home: HOME });
// Each path is read as itself, never as a folder (#395).
const notThere: PathKind = () => "missing";
const level = (tool: string, input: Record<string, unknown>) =>
  risk.classify(tool, input, CWD).level;

/** Files and folders that hold a secret and that the classifier did not name (issue #439). */
const SECRETS = [
  "~/.npmrc",
  "~/.netrc",
  "~/_netrc",
  "~/.pypirc",
  "~/.git-credentials",
  "~/.pgpass",
  "~/.gnupg/private-keys-v1.d/x.key",
  "~/.gnupg/pubring.kbx",
  "~/.kube/config",
  "~/.docker/config.json",
  "~/.azure/accessTokens.json",
  "~/.config/gcloud/credentials.db",
  "~/.ssh/authorized_keys",
  "~/.bash_history",
  "~/.zsh_history",
  "C:\\Users\\me\\.npmrc",
  "C:\\Users\\me\\.kube\\config",
  "/trabalho/proj/.npmrc",
  "/trabalho/proj/certs/client.pfx",
  "/trabalho/proj/certs/client.p12",
  "/trabalho/proj/app.keystore",
  "/trabalho/proj/secrets.kdbx",
];

describe("risk: more files that hold a secret (issue #439)", () => {
  test("each is a credential, whichever slash and case", () => {
    for (const path of SECRETS) {
      expect(credential(path), `${path} should be a credential`).toBe(true);
      expect(credential(path.toUpperCase()), `${path} in capitals`).toBe(true);
    }
  });

  test("a read, a write and a shell command that name one are high", () => {
    for (const path of ["~/.npmrc", "~/.kube/config", "~/.docker/config.json"]) {
      expect(level("Read", { file_path: path }), `Read ${path}`).toBe("high");
      expect(level("Write", { file_path: join(CWD, "x") + path.slice(1) }), `Write ${path}`).toBe(
        "high",
      );
      expect(level("Bash", { command: `cat ${path}` }), `cat ${path}`).toBe("high");
    }
    expect(level("Read", { file_path: join(CWD, ".npmrc") })).toBe("high");
  });

  test("a name that only looks like one is not", () => {
    for (const path of [
      "/trabalho/proj/src/npmrc-notes.md",
      "/trabalho/proj/docs/kubernetes.md",
      "/trabalho/proj/src/docker/Dockerfile",
      "/trabalho/proj/docker/config.yaml",
      "/trabalho/proj/src/known_hosts.ts",
      "/trabalho/proj/src/history.ts",
      "/trabalho/proj/certs/pfx.md",
    ]) {
      expect(credential(path), `${path} is not a credential`).toBe(false);
    }
  });

  test("the stores of the tools Flightdeck's sessions use are credentials too", () => {
    for (const path of [
      "~/.vault-token",
      "~/.boto",
      "~/.s3cfg",
      "~/.my.cnf",
      "~/.htpasswd",
      "~/.terraformrc",
      "~/.dockercfg",
      "~/.local/share/opencode/auth.json",
      "~/.codex/auth.json",
      "~/.psql_history",
      "~/.python_history",
      "~/.local/share/fish/fish_history",
      "C:\\Users\\me\\AppData\\Roaming\\Microsoft\\Windows\\PowerShell\\PSReadLine\\ConsoleHost_history.txt",
      "~/.oci/config",
      "~/.config/rclone/rclone.conf",
      "~/.config/helm/registry/config.json",
      "~/.cargo/credentials.toml",
      "~/.m2/settings.xml",
      "~/.gradle/gradle.properties",
      "~/.terraform.d/credentials.tfrc.json",
      "~/.gem/credentials",
      "C:\\Users\\me\\AppData\\Roaming\\GitHub CLI\\hosts.yml",
      "/trabalho/proj/key.ppk",
      "/trabalho/proj/vpn.ovpn",
      "/trabalho/proj/infra/terraform.tfstate",
      "/trabalho/proj/infra/terraform.tfstate.backup",
      "/trabalho/proj/svc.keytab",
    ]) {
      expect(credential(path), `${path} should be a credential`).toBe(true);
    }
  });

  test("a path written with an empty or a dot segment, or a trailing slash, is read as it resolves", () => {
    for (const path of [
      "~/.docker//config.json",
      "~/.docker/./config.json",
      "/trabalho/proj/.config/./gcloud/x",
      "/trabalho/proj/.config//gh/hosts.yml",
      "~/.npmrc/",
      "~/./.npmrc",
    ]) {
      expect(credential(path), `${path} should be a credential`).toBe(true);
    }
    expect(level("Read", { file_path: "/trabalho/proj/.docker/./config.json" })).toBe("high");
  });
});

describe("rule-risk: a partial name that can be one of those files (issue #439)", () => {
  const classify: ClassifyCall = (_tool, input) =>
    Object.values(input).some((v) => typeof v === "string" && credential(v)) ? "high" : "low";
  test("a wildcard that can stand for one is refused, as for .ssh", () => {
    for (const rule of [
      "~/.n*rc",
      "/trabalho/proj/.kub*/config",
      "/trabalho/proj/.dock*/config.json",
      "/trabalho/proj/.config/g*loud/x",
      "/trabalho/proj/.gnu*/x",
      "/trabalho/proj/.net*",
      "/trabalho/proj/.cargo/cred*",
      "/trabalho/proj/.m2/settings*.xml",
    ]) {
      expect(ruleLevel("Read", rule, classify, notThere), `Read(${rule})`).toBe("any");
    }
    expect(ruleLevel("Read", "/trabalho/proj/src/app-*.ts", classify, notThere)).toBe("low");
  });
});
