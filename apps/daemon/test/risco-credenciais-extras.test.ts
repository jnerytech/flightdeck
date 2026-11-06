import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { credential, RiskClassifier } from "../src/permissions/risk.ts";

const HOME = resolve("/casa/u");
const CWD = resolve("/trabalho/proj");
const risk = new RiskClassifier({ allowedRoots: [], home: HOME });
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
});
