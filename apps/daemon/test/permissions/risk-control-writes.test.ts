import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { RiskClassifier } from "../../src/permissions/domain/risk.ts";

const HOME = resolve("/casa/u");
const CWD = resolve("/trabalho/proj");
const ROOT = resolve("/trabalho/outra");
const risk = new RiskClassifier({ allowedRoots: [ROOT], home: HOME });
const WRITE_TOOLS = ["Write", "Edit", "MultiEdit", "NotebookEdit"];
const KEY: Record<string, string> = { NotebookEdit: "notebook_path" };
const write = (tool: string, path: string, cwd = CWD) =>
  risk.classify(tool, { [KEY[tool] ?? "file_path"]: path }, cwd);
const shell = (command: string, cwd = CWD) => risk.classify("Bash", { command }, cwd);

/** What the host or a tool runs on its own: a hook, the session's settings, a script, the CI (#3614). */
const CONTROL = [
  ".git/hooks/pre-commit",
  ".git/config",
  ".husky/pre-commit",
  ".claude/settings.json",
  ".claude/skills/x/SKILL.md",
  "package.json",
  "packages/a/package.json",
  ".github/workflows/ci.yml",
  ".vscode/tasks.json",
];

/** Paths that only look like one: another name, another folder, or the same words apart. */
const NEAR_MISSES = [
  "src/a.ts",
  "package.json.bak",
  "docs/package-json.md",
  ".gitignore",
  ".gitattributes",
  ".huskyrc",
  ".github/ISSUE_TEMPLATE/bug.md",
  ".github/workflows.md",
  "workflows/ci.yml",
  ".vscode/settings.json",
  ".claudeignore",
  "docs/claude/notes.md",
  "src/git/hooks.ts",
  "my.git/x",
];

describe("risk of a write to a file the host or a tool runs (#3614)", () => {
  test("every write tool is held for every control path, inside the cwd", () => {
    const missed = WRITE_TOOLS.flatMap((tool) =>
      CONTROL.map((path) => ({ tool, path, got: write(tool, join(CWD, path)).level })),
    ).filter((row) => row.got !== "high");
    expect(missed).toEqual([]);
  });

  test("a relative path, an allowed root and a differently written path are held too", () => {
    const rows = [
      write("Write", ".git/hooks/pre-commit"),
      write("Edit", join(ROOT, "package.json")),
      write("Write", join(CWD, ".GIT", "hooks", "x")),
      write("Write", ".husky\\pre-commit"),
      write("Write", join(CWD, "GIT~1", "hooks", "x")),
      write("Write", join(CWD, "src", "..", ".claude", "settings.json")),
    ];
    expect(rows.map((row) => row.level)).toEqual(Array(rows.length).fill("high"));
  });

  test("the reason says the file is one the host or a tool runs", () => {
    expect(write("Write", join(CWD, ".git/hooks/pre-commit")).reason).toBe(
      "writes a file the host or a tool runs",
    );
  });

  test("a path that only looks like a control path stays medium", () => {
    const wrongly = WRITE_TOOLS.flatMap((tool) =>
      NEAR_MISSES.map((path) => ({ tool, path, got: write(tool, join(CWD, path)).level })),
    ).filter((row) => row.got !== "medium");
    expect(wrongly).toEqual([]);
  });

  test("a project that lives under a control folder is not held for its own files", () => {
    const cwd = resolve("/casa/u/.claude/worktrees/proj");
    expect(write("Write", join(cwd, "src/a.ts"), cwd).level).toBe("medium");
    expect(write("Write", "src/a.ts", cwd).level).toBe("medium");
    expect(write("Write", join(cwd, ".git/hooks/x"), cwd).level).toBe("high");
    expect(write("Write", join(cwd, "package.json"), cwd).level).toBe("high");
  });

  test("a call that names both paths is held when either is a control path", () => {
    const got = risk.classify(
      "NotebookEdit",
      { file_path: join(CWD, "a.ts"), notebook_path: join(CWD, "package.json") },
      CWD,
    );
    expect(got.level).toBe("high");
  });

  test("a redirect onto a control path is held, whatever its form", () => {
    const forms = [">", ">>", "&>", "2>", ">|"];
    const missed = forms
      .flatMap((form) => CONTROL.map((path) => `echo x ${form} ${path}`))
      .filter((command) => shell(command).level !== "high");
    expect(missed).toEqual([]);
  });

  test("a redirect onto a path that only looks like one stays medium", () => {
    const wrongly = NEAR_MISSES.map((path) => `echo x > ${path}`).filter(
      (command) => shell(command).level !== "medium",
    );
    expect(wrongly).toEqual([]);
  });

  test("reading a control path or running a program on one is not a write", () => {
    const wrongly = [
      "cat package.json",
      "ls .git/hooks",
      "git status",
      "bun run test",
      "grep x .claude/settings.json",
    ].filter((command) => shell(command).level !== "medium");
    expect(wrongly).toEqual([]);
  });

  test("a redirect inside a project under a control folder is judged by its path in the project", () => {
    const cwd = resolve("/casa/u/.claude/worktrees/proj");
    expect(shell("echo x > out.txt", cwd).level).toBe("medium");
    expect(shell("echo x > .git/hooks/x", cwd).level).toBe("high");
  });

  test("a redirect target spelled with an escape or quotes is judged by the file it names", () => {
    const held = [
      "echo x > .g\\it/hooks/pre-commit",
      "echo x > pack\\age.json",
      "echo x > .clau\\de/settings.json",
      'echo x > ".git"/hooks/pre-commit',
      "echo x > '.git/hooks/pre-commit'",
      "echo x >.git/hooks/pre-commit",
    ];
    const missed = held.filter((command) => shell(command).level !== "high");
    expect(missed).toEqual([]);
  });

  test("a path is read from the deepest root that holds it", () => {
    const nested = resolve("/casa/u/.claude/worktrees/proj2");
    const roots = new RiskClassifier({ allowedRoots: [resolve("/casa/u"), nested], home: HOME });
    const call = (path: string) => roots.classify("Write", { file_path: path }, CWD).level;
    expect(call(join(nested, "src/a.ts"))).toBe("medium");
    expect(call(join(nested, ".git/hooks/x"))).toBe("high");
  });
});
