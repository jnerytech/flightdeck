import { describe, expect, test } from "bun:test";
import { ciPlan } from "../lib/ci-paths.ts";
import { unguardedGitCalls } from "../lib/git-args.ts";
import { visibleTsLiterals } from "../lib/i18n-sweep.ts";
import { testTiers } from "../lib/test-tiers.ts";

/**
 * #197: Sonar S5843 asked for smaller regular expressions in four scripts. These pin what each one
 * answers, one case per alternative and a near miss for each, so a split cannot drop one.
 */

const plan = (path: string) => ciPlan("pull_request", [path]);

describe("ci-paths: which jobs a path starts", () => {
  test("every path the e2e journeys read starts the e2e job, and a near miss does not", () => {
    const reads = [
      "scripts/e2e/journeys.e2e.ts",
      "scripts/lib/e2e-helpers.ts",
      "scripts/lib/demo-seed.ts",
      "scripts/lib/browser.ts",
      "scripts/lib/layout-guards.ts",
      "scripts/demo-seed.ts",
      "playwright.config.ts",
      "apps/daemon/src/server.ts",
      "scripts/test/fixtures.ts",
    ];
    const near = [
      "scripts/lib/e2e/nested.ts",
      "scripts/lib/other.ts",
      "scripts/lib/browser.tsx",
      "scripts/demo/nested.ts",
      "scripts/test/fixtures.test.ts",
      "scripts/test/dir/nested.ts",
      "docs/playwright.md",
      "tools/playwright.config.ts",
    ];
    expect([reads.map((p) => plan(p).e2e), near.map((p) => plan(p).e2e)]).toEqual([
      reads.map(() => true),
      near.map(() => false),
    ]);
  });

  test("every path the prints read starts the screenshots job, and a near miss does not", () => {
    const reads = [
      "scripts/demo.ts",
      "scripts/demo-shots.ts",
      "scripts/lib/axe.ts",
      "scripts/lib/browser.ts",
      "scripts/lib/layout-guards.ts",
      "scripts/lib/print-theme.ts",
      "scripts/lib/shots-names.ts",
      "scripts/lib/visual.ts",
      "scripts/lib/e2e-helpers.ts",
      "scripts/lib/demo-seed.ts",
      "scripts/test/fixtures.ts",
    ];
    const near = [
      "scripts/e2e/journeys.e2e.ts",
      "scripts/lib/axe-more.ts",
      "scripts/lib/visual-more.ts",
      "scripts/lib/other.ts",
      "scripts/demo/nested.ts",
      "scripts/test/fixtures.test.ts",
      "scripts/test/dir/nested.ts",
      "playwright.config.ts",
    ];
    expect([reads.map((p) => plan(p).screenshots), near.map((p) => plan(p).screenshots)]).toEqual([
      reads.map(() => true),
      near.map(() => false),
    ]);
  });
});

describe("git-args: which names carry a branch or a revision", () => {
  const flagged = (name: string) =>
    unguardedGitCalls(`await git(repo, "x", ${name});`, "x.ts").length;

  test("a name that starts like a ref, ends like one or is a revision is flagged", () => {
    const names = [
      "base",
      "baseRef",
      "branch",
      "branchName",
      "source",
      "ref",
      "refresh",
      "against",
      "upstream",
      "upstreamName",
      "rev",
      "revision",
      "revX",
      "rev_x",
      "revisionId",
      "startRef",
      "targetBranch",
      "myBase",
      "someBranch",
      "fooSource",
      "fooRev",
      "fooRef",
      "currentAgainst",
      "currentUpstream",
    ];
    expect(names.map(flagged)).toEqual(names.map(() => 1));
  });

  test("other names are not", () => {
    const names = [
      "path",
      "cwd",
      "revert",
      "review",
      "start",
      "startup",
      "target",
      "Base",
      "mybase",
      "database",
      "rebase",
    ];
    expect(names.map(flagged)).toEqual(names.map(() => 0));
  });
});

describe("test-tiers: what makes a test integration", () => {
  const tier = (body: string) =>
    testTiers(new Map([["apps/x/test/a.test.ts", body]]))["apps/x/test/a.test.ts"];

  test("a daemon, a server, a spawn, a socket or a fake CLI makes integration", () => {
    const bodies = [
      "await startDaemon();",
      "await startServer(0);",
      "Bun.spawn(['a']);",
      "Bun.spawnSync (['a']);",
      "spawnSync('a');",
      "spawn('a');",
      "execFileSync('a');",
      "execSync('a');",
      "installFakeCli();",
      "installFakeClaude ();",
      "new FrameClient(url);",
      "const c: FrameClient = x;",
      "Bun.serve({});",
      "new WebSocket(url);",
      "createServer(handler);",
    ];
    expect(bodies.map(tier)).toEqual(bodies.map(() => "integration"));
  });

  test("a near miss, or the same word in a comment, stays unit", () => {
    const bodies = [
      "respawn('a');",
      "myspawnSync('a');",
      "startServers(0);",
      "startDaemons();",
      "execSyncs();",
      "Bun.spawned();",
      "installFakeOther();",
      "createServers();",
      "// spawn('a');",
      "/* execSync('a') */",
    ];
    expect(bodies.map(tier)).toEqual(bodies.map(() => "unit"));
  });
});

describe("i18n-sweep: Portuguese words in a thrown error", () => {
  const found = (text: string) =>
    visibleTsLiterals(`throw new Error("${text}");`).map((literal) => literal.text);

  test("each word only Portuguese uses counts", () => {
    const words = [
      "sem",
      "para",
      "este",
      "esta",
      "isso",
      "fora",
      "dados",
      "antes",
      "depois",
      "erro",
      "arquivo",
      "resposta",
      "desconhecido",
      "existe",
      "encontrado",
      "encontrada",
      "nenhum",
      "nenhuma",
      "veio",
      "confira",
      "salvar",
      "pasta",
      "chamado",
      "perdida",
      "suportada",
    ];
    expect(words.map((word) => found(`x ${word} y`))).toEqual(words.map((word) => [`x ${word} y`]));
  });

  test("case does not matter, and a word inside another word does not count", () => {
    expect(found("x PASTA y")).toEqual(["x PASTA y"]);
    expect([found("semantic"), found("paradise"), found("no data"), found("encontrados")]).toEqual([
      [],
      [],
      [],
      [],
    ]);
  });
});
