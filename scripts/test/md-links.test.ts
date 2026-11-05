import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { anchorsOf, brokenLinks, githubSlug, missingDocRefs } from "../lib/md-links.ts";

const ROOT = resolve(import.meta.dir, "../..");
const tracked = (...patterns: string[]) =>
  spawnSync("git", ["ls-files", ...patterns], { cwd: ROOT, encoding: "utf8" })
    .stdout.split("\n")
    .filter(Boolean);
const read = (paths: string[]) =>
  new Map(paths.map((p) => [p, readFileSync(join(ROOT, p), "utf8")]));

describe("md-links", () => {
  test("headings slug as GitHub does, accents and code included, duplicates numbered", () => {
    expect(githubSlug("Remote access over Tailscale")).toBe("remote-access-over-tailscale");
    expect(githubSlug("A partir do código-fonte")).toBe("a-partir-do-código-fonte");
    expect(githubSlug("`flightdeckd claude` and the channel")).toBe(
      "flightdeckd-claude-and-the-channel",
    );
    expect(githubSlug("Phase 30: summary, webhooks (and more)!")).toBe(
      "phase-30-summary-webhooks-and-more",
    );
    expect([...anchorsOf("# A\n\n## Fix\n\n```\n## Not a heading\n```\n\n## Fix\n")]).toEqual([
      "a",
      "fix",
      "fix-1",
    ]);
  });

  test("a link to a missing file or a missing heading is reported with its line", () => {
    const files = new Map([
      ["docs/a.md", "# A\n\nSee [b](b.md#tail) and [c](./c.md) and [top](#a) and [no](#nope).\n"],
      ["docs/b.md", "# B\n\n## Head\n"],
    ]);
    const exists = (path: string) => files.has(path);
    expect(brokenLinks(files, exists)).toEqual([
      "docs/a.md:3: b.md#tail (no heading #tail in docs/b.md)",
      "docs/a.md:3: ./c.md (no file docs/c.md)",
      "docs/a.md:3: #nope (no heading #nope in docs/a.md)",
    ]);
  });

  test("web links, mail, folders, links inside code and a title after the target are fine", () => {
    const files = new Map([
      [
        "README.md",
        '# R\n\n[w](https://x.dev/a#b) [m](mailto:a@b.c) [d](docs/) [t](docs/b.md "B") `[x](nope.md)`\n\n```\n[y](nope.md)\n```\n',
      ],
      ["docs/b.md", "# B\n"],
    ]);
    const exists = (path: string) => files.has(path) || path === "docs";
    expect(brokenLinks(files, exists)).toEqual([]);
  });

  test("a docs path the code names must exist", () => {
    const code = new Map([
      ["scripts/test/x.test.ts", 'read("docs/DECISIONS.md"); read("docs/SPEC-fase-99.md")'],
    ]);
    expect(missingDocRefs(code, (path) => path === "docs/DECISIONS.md")).toEqual([
      "scripts/test/x.test.ts: docs/SPEC-fase-99.md",
    ]);
  });

  test("the repository's own docs have no broken link, and the code names no missing doc", () => {
    const exists = (path: string) => existsSync(join(ROOT, path));
    expect(brokenLinks(read(tracked("*.md")), exists)).toEqual([]);
    // Tests name docs paths as fixtures in temporary repositories; one that reads a real doc
    // fails by itself when the doc moves. The other code must name docs that exist.
    const code = tracked("*.ts", "*.tsx", "*.rs", "*.yml", "*.json").filter(
      (path) => !/(^|\/)test\//.test(path) && !/\.test\.tsx?$/.test(path),
    );
    expect(missingDocRefs(read(code), exists)).toEqual([]);
  });
});
