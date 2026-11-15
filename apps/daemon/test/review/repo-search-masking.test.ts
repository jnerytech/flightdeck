import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { searchRepository } from "../../src/review/search.ts";
import { event, fakeRg, onWindows, setup, teardown } from "./repo-search-setup.ts";

afterEach(teardown);

describe("repo-search-masking: what a search never lets leave the host (#829, #806)", () => {
  test("by content, a token in a file that is no credential leaves the host masked, even one cut at 200 characters (#829)", async () => {
    const { repo } = await setup();
    // A fake token of GitHub's shape; the test never uses a real one.
    const token = `ghp_${"A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"}`;
    writeFileSync(
      join(repo, "src", "config.js"),
      [
        `const panelToken = "${token}";`,
        `// panel ${"x".repeat(190)}${token}`,
        "-----BEGIN RSA PRIVATE KEY----- panel MIIEowIBAAKCAQEA",
      ].join("\n") + "\n",
    );
    const found = await searchRepository(
      repo,
      { mode: "content", query: "panel" },
      { rg: () => null },
    );
    const lines = found.matches.filter((m) => m.path === "src/config.js").map((m) => m.text ?? "");
    expect([
      lines.length,
      lines.some((text) => text.includes("ghp_") || text.includes("A1b2C3d4")),
      lines.some((text) => text.includes("MIIEowIBAAKCAQEA") || text.includes("PRIVATE KEY")),
      lines.every((text) => Array.from(text).length <= 200),
      lines[0] ?? "",
    ]).toEqual([3, false, false, true, 'const [redacted]";']);
  });

  test("a private key's body lines leave the host masked, without their header on the line (#829)", async () => {
    const { repo } = await setup();
    // A fake key body of PEM's shape: 64 base64 characters a line; not a real key.
    const body = "MIIEowIBAAKCAQEAu1SU1LfVLPHCozMxH2Mo4lgOEePzNm0tRgeLezV6ffAt0gun";
    writeFileSync(
      join(repo, "notes", "setup.md"),
      `${body}\nMIIEpanelQEAu1SU1LfVLPHCozMxH2Mo4lg\n`,
    );
    const found = await searchRepository(
      repo,
      { mode: "content", query: "MIIE" },
      { rg: () => null },
    );
    const lines = found.matches.filter((m) => m.path === "notes/setup.md").map((m) => m.text);
    expect(lines).toEqual(["[redacted]", "[redacted]"]);
  });

  test("a key's body lines with quotes, a comment mark, a comma, a CR or short padding leave masked too (#829)", async () => {
    const { repo } = await setup();
    // Fake key body lines of PEM's shape; not a real key.
    const body = "MIIEowIBAAKCAQEAu1SU1LfVLPHCozMxH2Mo4lgOEePzNm0tRgeLezV6ffAt0gun";
    writeFileSync(
      join(repo, "notes", "keys.js"),
      [`  "${body}",`, `# ${body}`, `// ${body}`, ` * ${body}`].join("\n") + "\n",
    );
    // A second file: a search keeps 5 lines a file.
    writeFileSync(
      join(repo, "notes", "keys-end.js"),
      ["MIIEow\rIBAAKCAQEAu1SU1LfVLPHCozMxH2Mo4lgOE", "MIIEpQ0tRgeLe=="].join("\n") + "\n",
    );
    const found = await searchRepository(
      repo,
      { mode: "content", query: "MIIE" },
      { rg: () => null },
    );
    const lines = found.matches.filter((m) => m.path.startsWith("notes/keys")).map((m) => m.text);
    expect(lines).toEqual(Array(6).fill("[redacted]"));
  });

  test("a line of 100 000 characters leaves cut to 200, with no token from anywhere in it (#829)", async () => {
    const { repo } = await setup();
    // A fake token of GitHub's shape; the test never uses a real one.
    const token = `ghp_${"A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"}`;
    // Each token stands apart, as one does in code; the first starts at 190, across the cut.
    const line = `panel ${"x".repeat(183)} ${token} ${"y".repeat(1000)} ${token} ${"z".repeat(98_000)}`;
    writeFileSync(join(repo, "src", "huge.js"), `${line}\n`);
    const found = await searchRepository(
      repo,
      { mode: "content", query: "panel" },
      { rg: () => null },
    );
    const text = found.matches.find((m) => m.path === "src/huge.js")?.text ?? "";
    expect([Array.from(text).length, text.includes("ghp_"), text.includes("A1b2C3d4")]).toEqual([
      200,
      false,
      false,
    ]);
  });

  test.skipIf(onWindows)(
    "by content with rg, the lines leave masked the same way (#829)",
    async () => {
      const { repo } = await setup();
      // A fake token and a fake key body line; neither is real.
      const token = `ghp_${"A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"}`;
      const body = "MIIEowIBAAKCAQEAu1SU1LfVLPHCozMxH2Mo4lgOEePzNm0tRgeLezV6ffAt0gun";
      const rg = fakeRg(
        [
          event({ text: "./src/panel.ts" }, 1, { text: `const panelToken = "${token}";\n` }),
          event({ text: "./src/panel.ts" }, 2, { text: `  "${body}",\n` }),
        ].join("\n"),
      );
      const found = await searchRepository(
        repo,
        { mode: "content", query: "panel" },
        { rg: () => rg.path },
      );
      expect(found.matches.map((m) => m.text)).toEqual(['const [redacted]";', "[redacted]"]);
    },
  );

  test("a file named after a token is never listed, by name or by content (#829)", async () => {
    const { repo } = await setup();
    // A fake token of GitHub's shape in the file's name; the test never uses a real one.
    const named = `panel-ghp_${"A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"}.txt`;
    writeFileSync(join(repo, "src", named), "panel\n");
    const leaks = async (mode: "name" | "content") =>
      (await searchRepository(repo, { mode, query: "panel" }, { rg: () => null })).matches.some(
        (m) => m.path.includes("ghp_"),
      );
    expect([await leaks("name"), await leaks("content")]).toEqual([false, false]);
  });

  test("an untracked .mcp.json and .claude/settings.local.json keep their lines on the host, and are marked by name (#806)", async () => {
    const { repo } = await setup();
    mkdirSync(join(repo, ".claude"));
    writeFileSync(join(repo, ".mcp.json"), '{"note":"panel secret"}\n');
    writeFileSync(join(repo, ".claude", "settings.local.json"), '{"note":"panel secret"}\n');
    const content = await searchRepository(
      repo,
      { mode: "content", query: "panel secret" },
      { rg: () => null },
    );
    const byName = await searchRepository(repo, { mode: "name", query: "mcp" });
    const local = await searchRepository(repo, { mode: "name", query: "settings.local" });
    expect([content.matches, byName.matches, local.matches]).toEqual([
      [],
      [{ path: ".mcp.json", secret: true }],
      [{ path: ".claude/settings.local.json", secret: true }],
    ]);
  });
});
