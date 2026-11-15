import { describe, expect, test } from "bun:test";
import { addedLines, removedLines, riskyEdits, riskyFiles } from "../../lib/pr/security-gate.ts";

describe("security-gate: the app's dictionaries are text (#1541)", () => {
  const EN = "apps/desktop/src/i18n/en.ts";
  const PT = "apps/desktop/src/i18n/pt-BR.ts";

  test("#1587's text-only edits, against dictionaries whose other text says token, secret or permission, need no review", () => {
    // Exactly #1587's diff of the two dictionaries.
    const diff = [
      `diff --git a/${EN} b/${EN}`,
      `--- a/${EN}`,
      `+++ b/${EN}`,
      "@@ -5460 +5460 @@ export const en: Dictionary = {",
      '-      "The system, versions, hooks, sign-in, tools and features of every host side by side. A cell that differs from what most hosts have is marked, and the features row names the ones a host lacks or adds.",',
      '+      "The system, versions, hooks, sign-in, tools and features of every host side by side. A cell that differs from what most hosts have is marked; with no majority (two hosts, an even split) every differing cell is. The features row names the ones a host lacks or adds.",',
      "@@ -5466,0 +5467 @@ export const en: Dictionary = {",
      '+    differsTied: "Differs, with no majority among the hosts",',
      `diff --git a/${PT} b/${PT}`,
      `--- a/${PT}`,
      `+++ b/${PT}`,
      "@@ -5470 +5470 @@ export const ptBR = {",
      '-      "Sistema, versões, hooks, login, ferramentas e recursos de cada host lado a lado. A célula que difere do que a maioria dos hosts tem fica marcada, e a linha de recursos diz quais um host não tem ou tem a mais.",',
      '+      "Sistema, versões, hooks, login, ferramentas e recursos de cada host lado a lado. A célula que difere do que a maioria dos hosts tem fica marcada; sem maioria (dois hosts, divisão igual), toda célula que difere fica. A linha de recursos diz quais um host não tem ou tem a mais.",',
      "@@ -5476,0 +5477 @@ export const ptBR = {",
      '+    differsTied: "Difere, sem maioria entre os hosts",',
    ].join("\n");
    // The shapes of en.ts's other text that say token, secret or permission: a long value on a line
    // of its own, a key that opens a group, a group of entries on one line.
    const head = [
      "export const en: Dictionary = {",
      "  usage: {",
      "    share:",
      '      "Share of the tokens of the last 7 days. The trend compares days 1–3 with days 4–6.",',
      "    tokens: {",
      "      secret:",
      "        'It needs the project permission to write.',",
      "        `The snippet has a secret and cannot be saved.`,",
      '    title: { password: "Password for {name}", passphrase: "Key passphrase for {name}" },',
      '    picker: { none: "No secret" },',
      "    },",
      "  },",
      "};",
    ].join("\n");
    const added = riskyFiles(addedLines(diff));
    const edits = riskyEdits(added, removedLines(diff), () => head);
    expect([added, edits]).toEqual([[], []]);
  });

  test("from the security review: a long run of spaces in a dictionary line is quick", () => {
    const started = performance.now();
    const line = `    a: { b: "x"${" ".repeat(50_000)}!`;
    const found = riskyFiles(new Map([[EN, [line]]]));
    expect([found, performance.now() - started < 500]).toEqual([[], true]);
  });

  test("from the second security review (#1588): every text shape reads a long run of spaces in linear time", () => {
    // One line per alternative of the text shapes, each ending in a character that makes it fail
    // after the spaces: a quadratic alternative takes seconds on 60,000 spaces, a linear one ms.
    const spaces = " ".repeat(60_000);
    const shapes = [
      `a:${spaces}!`,
      `a: {${spaces}!`,
      `"x"${spaces}!`,
      `a: "x"${spaces}!`,
      `a: { b: "x"${spaces}!`,
    ];
    for (const line of shapes) {
      const started = performance.now();
      riskyFiles(new Map([[EN, [line]]]));
      expect([line.slice(0, 8), performance.now() - started < 500]).toEqual([
        line.slice(0, 8),
        true,
      ]);
    }
  });

  test("code beside that text is still read: a template with an expression, a call, a spawn", () => {
    const removed = new Map([[EN, ['      "Old text",']]]);
    const heads = [
      "    count: `${n} tokens left`,",
      '    read: () => localStorage.getItem("token"),',
      '    run: { go: Bun.spawn(["sh"]) },',
    ];
    const verdicts = heads.map((head) => riskyEdits([], removed, () => head)[0]?.why ?? []);
    expect(verdicts).toEqual([["edits secret code"], ["edits secret code"], ["edits spawn code"]]);
  });

  test("added keys whose words say token, secret or permission are not risky; a secret value or code is", () => {
    const added = new Map([
      [
        EN,
        [
          '    tokenHint: "Paste the pairing token here",',
          '    permissionDenied: "Permission denied",',
        ],
      ],
      [PT, ['    secretSaved: "Segredo salvo no cofre",']],
      ["apps/desktop/src/i18n/index.ts", ["const token = read();"]],
    ]);
    // Secret-shaped values are built here, so no scanner reads a token in this file.
    const ghp = `ghp_${"a".repeat(36)}`;
    const leaked = new Map([[EN, [`    example: "${ghp}",`]]]);
    const code = new Map([[PT, ['    run: () => Bun.spawn(["sh"]),']]]);
    // From the security review: an npm token, and a secret pasted in a comment, count too.
    const npm = new Map([[EN, [`    // npm_${"b".repeat(36)}`]]]);
    expect([riskyFiles(added), riskyFiles(leaked), riskyFiles(code), riskyFiles(npm)]).toEqual([
      [{ path: "apps/desktop/src/i18n/index.ts", why: ["secret"] }],
      [{ path: EN, why: ["secret"] }],
      [{ path: PT, why: ["spawn"] }],
      [{ path: EN, why: ["secret"] }],
    ]);
  });

  test("a dictionary split by domain (#1598) is text too: i18n/<lang>/<domain>.ts reads as en.ts and pt-BR.ts do", () => {
    const ENX = "apps/desktop/src/i18n/en/hub.ts";
    const PTX = "apps/desktop/src/i18n/pt-BR/hub.ts";
    const added = new Map([
      [
        ENX,
        [
          "export const hub = {",
          '    tokenHint: "Paste the pairing token here",',
          '    permissionDenied: "Permission denied",',
          '} satisfies Pick<Dictionary, "hub">;',
        ],
      ],
      [PTX, ['    secretSaved: "Segredo salvo no cofre",']],
    ]);
    const ghp = `ghp_${"a".repeat(36)}`;
    const leaked = new Map([[ENX, [`    example: "${ghp}",`]]]);
    const code = new Map([[PTX, ['    run: () => Bun.spawn(["sh"]),']]]);
    // Another language folder or a deeper path is no dictionary.
    const other = new Map([
      ["apps/desktop/src/i18n/en/deep/hub.ts", ['    tokenHint: "Paste the pairing token here",']],
    ]);
    const language = new Map([
      ["apps/desktop/src/i18n/fr/hub.ts", ['    tokenHint: "Paste the pairing token here",']],
    ]);
    expect([
      riskyFiles(added),
      riskyFiles(leaked),
      riskyFiles(code),
      riskyFiles(other),
      riskyFiles(language),
    ]).toEqual([
      [],
      [{ path: ENX, why: ["secret"] }],
      [{ path: PTX, why: ["spawn"] }],
      [{ path: "apps/desktop/src/i18n/en/deep/hub.ts", why: ["secret"] }],
      [{ path: "apps/desktop/src/i18n/fr/hub.ts", why: ["secret"] }],
    ]);
  });

  test("from the OpenCode review: only plain text entries are exempt; code in a dictionary is read in every area", () => {
    const code = new Map([
      [EN, ["    mode: chmodSync(file, 0o600),", '    gh: localStorage.getItem("token"),']],
      [PT, ["    saved: `Token salvo`,", "    \"permission-denied\": 'Permissão negada',"]],
    ]);
    expect(riskyFiles(code)).toEqual([{ path: EN, why: ["secret", "permission"] }]);
  });

  test("from the security review: an escaped backslash before a quote ends the literal, and a long run of backslashes is quick", () => {
    // In JS this is "a\\" + Bun.spawn(...) and a comment: code, not one literal.
    const trick = new Map([[EN, ['    k: "a\\\\" + Bun.spawn(["sh"]) // \\"']]]);
    const started = performance.now();
    const slow = riskyFiles(new Map([[PT, [`    k: "${"\\".repeat(40)}`]]]));
    expect([riskyFiles(trick), slow, performance.now() - started < 100]).toEqual([
      [{ path: EN, why: ["spawn"] }],
      [],
      true,
    ]);
  });

  test("an edited key reads the dictionary at HEAD as text too; a secret-handling edit elsewhere still counts", () => {
    const removed = new Map([
      [EN, ['    tokenHint: "Paste the token",']],
      ["apps/daemon/src/vault-read.ts", ["const x = 1;"]],
    ]);
    const heads: Record<string, string> = {
      [EN]: 'export const en = {\n  tokenHint: "Paste the pairing token here",\n  permissionDenied: "Permission denied",\n};',
      "apps/daemon/src/vault-read.ts": "export const password = readPassword();",
    };
    expect(riskyEdits([], removed, (path) => heads[path] ?? null)).toEqual([
      { path: "apps/daemon/src/vault-read.ts", why: ["edits secret code"] },
    ]);
  });
});
