import { describe, expect, test } from "bun:test";
import { credential, isControl } from "../src/permissions/sensitive-paths.ts";

/** The same folder or file under the other names NTFS gives it (issues #1034, #1064). */
const CONTROL = [
  // The control folders and their 8.3 short names, with a stream, a dot or a space.
  ".git/hooks/pre-commit",
  "GIT~1/hooks/pre-commit",
  "src/GIT~1/hooks/pre-commit",
  ".git::$INDEX_ALLOCATION/config",
  ".git./hooks/pre-commit",
  ".git /hooks/pre-commit",
  "CLAUDE~1/settings.json",
  ".claude::$INDEX_ALLOCATION/settings.json",
  "HUSKY~1/pre-commit",
  "sub\\GIT~1\\hooks\\pre-commit",
  // The control files by name, with a stream or a trailing dot.
  "package.json::$DATA",
  "package.json.",
  ".mcp.json:stream",
  // A control folder and a name in it.
  "GITHUB~1/workflows/ci.yml",
  ".github./workflows/ci.yml",
  "VSCODE~1/tasks.json",
  ".vscode/tasks.json::$DATA",
];

/** Ordinary paths that only look like one of those. */
const ORDINARY = [
  "src/.gitignore",
  ".github/CODEOWNERS",
  ".git~1/x",
  "mygit~1/x",
  "git~x/hooks",
  "docs/package.jsonx",
  "src/index.ts",
  "C:\\work\\api\\src\\main.ts",
];

describe("sensitive-paths: a control path under an NTFS name is still a control path (#1064)", () => {
  for (const path of CONTROL) {
    test(`${JSON.stringify(path)} is a control path`, () => {
      expect(`${path}: ${isControl(path)}`).toBe(`${path}: true`);
    });
  }

  test("ordinary paths that look like them are not", () => {
    expect(ORDINARY.filter((path) => isControl(path))).toEqual([]);
  });

  test("a credential folder or file by its short name, a stream or a dot is still a credential", () => {
    const hidden = [
      "SSH~1/id_ed25519",
      ".ssh./config",
      ".aws::$INDEX_ALLOCATION/credentials",
      ".env::$DATA",
      ".env.",
      "id_rsa::$DATA",
      "KUBE~1/config",
      "C:\\Users\\me\\.ssh.\\known_hosts",
    ];
    expect(hidden.filter((path) => !credential(path))).toEqual([]);
  });

  test("an ordinary file is not a credential for looking like one", () => {
    expect(["src/ssh~x/a.ts", "env.ts", "docs/readme~1.md"].filter((p) => credential(p))).toEqual(
      [],
    );
  });

  test("a name is still read as written: a colon or a short-name tilde in a POSIX file does not hide it", () => {
    const written = [
      "host:8080.key",
      "a/cert:prod.pfx",
      "app:prod.env",
      "terraform:prod.tfstate",
      "ID_ED2~1",
      "id_rsa~1",
      "keys/id_ed25519:backup",
    ];
    expect(written.filter((path) => !credential(path))).toEqual([]);
    expect(isControl("tools:x/.git/hooks/pre-commit")).toBe(true);
    expect(isControl("a:b/package.json")).toBe(true);
  });
});
