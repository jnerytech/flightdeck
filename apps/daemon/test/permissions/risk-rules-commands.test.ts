import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { RiskClassifier, validRegex } from "../../src/permissions/domain/risk.ts";
import {
  bash,
  CWD,
  classify,
  HOME,
  MEDIUM,
  notHigh,
  wrongReasons,
} from "../support/permissions-risk-rules.ts";

describe("risk rules: git (#2474)", () => {
  test("a forced push, a hard reset and a forced clean are high, in any position of the global options", () => {
    expect(
      wrongReasons([
        ["git push -f", "git push forçado"],
        ["git push -fu origin x", "git push forçado"],
        ["git push --force", "git push forçado"],
        ["git push --FORCE", "git push forçado"],
        ["git push origin +main", "git push forçado"],
        ["git push --force-with-lease=x", "git push forçado"],
        ["git -C sub push -f", "git push forçado"],
        ["git -c core.x=1 push -f", "git push forçado"],
        ["git --git-dir d push -f", "git push forçado"],
        ["git --work-tree d push -f", "git push forçado"],
        ["git --no-pager push -f", "git push forçado"],
        ["git -C a -c b=c push -f", "git push forçado"],
        ["git reset --hard", "git reset --hard"],
        ["git -C sub reset --hard HEAD~2", "git reset --hard"],
        ["git clean -f", "git clean -f"],
        ["git clean -fd", "git clean -f"],
        ["git clean --force", "git clean -f"],
        ["git -C sub clean -fdx", "git clean -f"],
        ["GIT.EXE push -f", "git push forçado"],
      ]),
    ).toEqual([]);
  });

  test("the same words under another subcommand, or without the force, stay medium", () => {
    expect(
      notHigh([
        "git push",
        "git push -u origin x",
        "git push --follow-tags",
        "git push origin feature/x",
        "git reset --soft HEAD~1",
        "git reset HEAD file",
        "git clean -n",
        "git clean",
        "git status -f",
        "git log --force",
        "git commit -f",
        "git stash --hard",
        "git checkout -f x",
        "git -C push status",
        "git -c push status",
        "git --git-dir push status",
        "git --work-tree push status",
        // The flag is read after the subcommand: a folder named `-f` is not a force.
        "git -C -f push origin x",
        "git -C --hard reset HEAD",
        "git -C -f clean -n",
        "git",
        "echo git push -f",
      ]),
    ).toEqual([]);
  });
});

describe("risk rules: redirections and credential words in a command (#2474)", () => {
  test("a redirect to a sink or into the project is medium, anywhere else high", () => {
    expect(
      notHigh([
        "echo x > /dev/null",
        "echo x >/dev/null",
        "echo x >> /dev/null",
        "echo x > /dev/stdout",
        "echo x > /dev/stderr",
        "echo x 2> /dev/null",
        "echo x > nul",
        "echo x > NUL",
        "echo x > $null",
        "echo x > out.txt",
        'echo x > "a b.txt"',
        "echo x > 'a b.txt'",
        "echo x > sub/out.txt",
        "echo x > ./out.txt",
        "ls 2>&1",
        "ls >&2",
        "echo a=>b",
        "echo x -> y",
      ]),
    ).toEqual([]);
    const out = "redirecionamento para fora do cwd";
    expect(
      wrongReasons([
        ["echo x > /tmp/f", out],
        ["echo x >/tmp/f", out],
        ["echo x >> /tmp/f", out],
        ["echo x 2> /tmp/f", out],
        ["echo x 1>/tmp/f", out],
        ['echo x > "/tmp/a b"', out],
        ["echo x > '/tmp/a b'", out],
        ["echo x > ../f", out],
        ["echo x > ~/f", out],
        ["echo x > /dev/tty", out],
        ["echo x > $HOME/f", out],
        ["echo x > %TEMP%\\f", out],
        ["echo x > out.txt > /tmp/f", out],
        ["echo x > /dev/null > /tmp/f", out],
        ["ls;echo x > /tmp/f", out],
      ]),
    ).toEqual([]);
  });

  test("a descriptor copy stays medium, but a word that only starts or ends like one is a file", () => {
    const out = "redirecionamento para fora do cwd";
    expect(notHigh(["ls >&2", "ls >&-", "ls >&2-", "ls 2>&1", "ls >&22"])).toEqual([]);
    expect(
      wrongReasons([
        ["echo x >&2/../../etc/x", out],
        ["echo x >&2-/../../etc/x", out],
        ["echo x >&-/../../etc/x", out],
        ["echo x >&/tmp/f-", out],
        ["echo x >&/tmp/f2", out],
        ["echo x >&/tmp/f", out],
      ]),
    ).toEqual([]);
  });

  test("a quoted file name with a parenthesis in it is a plain name, only a leading one is a substitution", () => {
    const out = "redirecionamento para fora do cwd";
    expect(
      notHigh(['echo x > "report (1).txt"', 'echo x > "a=(1).txt"', "echo x > 'f(x)'"]),
    ).toEqual([]);
    expect(
      wrongReasons([
        ["echo x > (cat)", out],
        ["echo x > =(cat)", out],
      ]),
    ).toEqual([]);
  });

  test("a home path is joined to the home folder: `~/` cannot climb out of it back into the project", () => {
    // The home folder sits inside the project here, so only the join decides where `~/..` lands.
    const inner = new RiskClassifier({ allowedRoots: [], home: join(CWD, "home") });
    const shell = (command: string) => inner.classify("Bash", { command }, CWD);
    expect(shell("echo x > ~/f")).toMatchObject({ level: "medium", reason: MEDIUM });
    expect(shell("echo x > ~/../../etc/x")).toMatchObject({
      level: "high",
      reason: "redirecionamento para fora do cwd",
    });
  });

  test("a credential path inside a command is high, wherever the quotes and separators put it", () => {
    const credential = "caminho de credencial";
    expect(
      wrongReasons([
        ["cat .env", credential],
        ['cat ".env"', credential],
        ["cat '.env'", credential],
        ["echo x;cat .env", credential],
        ["(cat .env)", credential],
        ["cp a=.env", credential],
        ["echo a,.env", credential],
        ["cat <.env", credential],
        ["cat ~/.ssh/id_rsa", credential],
        // `.env*` as the spec writes it: a look-alike is high too.
        ["echo .environment", credential],
      ]),
    ).toEqual([]);
    expect(notHigh(["cat env", "cat environment.ts"])).toEqual([]);
  });

  test("OpenCode's configuration folder is high in a command, however it is spelled", () => {
    const opencode = "writes OpenCode's configuration";
    expect(
      wrongReasons([
        ["cat ~/.config/opencode/opencode.json", opencode],
        ["cat ~/.CONFIG/OpenCode/x", opencode],
        ["type C:\\Users\\u\\.config\\opencode\\opencode.json", opencode],
        ["cat .config/opencode", opencode],
        ["cat /x/.config/opencode/plugin.js", opencode],
      ]),
    ).toEqual([]);
    expect(
      notHigh([
        "cat .config/opencodex/a",
        "cat .config",
        "cat opencode/.config",
        "cat .configs/opencode",
      ]),
    ).toEqual([]);
  });

  test("risk.extraHigh patterns are high with their own reason, and an empty list adds nothing", () => {
    const extra = new RiskClassifier({
      allowedRoots: [],
      home: HOME,
      extraHigh: ["terraform\\s+apply"],
    });
    expect(extra.classify("Bash", { command: "TERRAFORM  apply -y" }, CWD)).toMatchObject({
      level: "high",
      reason: "padrão de risk.extraHigh",
    });
    expect(extra.classify("Bash", { command: "terraform plan" }, CWD).level).toBe("medium");
    expect(
      new RiskClassifier({ allowedRoots: [], home: HOME }).classify(
        "Bash",
        { command: "terraform apply" },
        CWD,
      ).level,
    ).toBe("medium");
    expect(validRegex("a+")).toBe(true);
    expect(validRegex("(")).toBe(false);
  });
});

describe("risk rules: the network mark of a shell command (#2474)", () => {
  test("every program that talks to the network, with its folder and its .exe, marks the command", () => {
    const programs = [
      "curl",
      "wget",
      "invoke-webrequest",
      "iwr",
      "invoke-restmethod",
      "irm",
      "ssh",
      "scp",
      "sftp",
      "rsync",
      "nc",
      "ncat",
      "telnet",
      "ftp",
    ];
    const missing = programs.flatMap((p) =>
      [
        `${p} host`,
        `/usr/bin/${p} host`,
        `${p.toUpperCase()}.EXE host`,
        `cd x && ${p} host`,
        `ls | ${p} host`,
      ].filter((command) => !bash(command).network),
    );
    expect(missing).toEqual([]);
  });

  test("git push, pull, fetch and clone mark it, every other subcommand does not", () => {
    for (const sub of ["push", "pull", "fetch", "clone"]) {
      expect(bash(`git ${sub} origin`).network).toBe(true);
      expect(bash(`git -C d ${sub} origin`).network).toBe(true);
    }
    const quiet = [
      "status",
      "add .",
      "commit -m x",
      "diff",
      "log",
      "remote -v",
      "branch",
      "checkout x",
    ];
    expect(quiet.filter((sub) => bash(`git ${sub}`).network)).toEqual([]);
    expect(
      ["ls", "echo curl", "cat wget", "echo ssh host", "pushd x", "git -C push status"].filter(
        (c) => bash(c).network,
      ),
    ).toEqual([]);
  });

  test("a command that is not text, or any MCP or OpenCode tool, is marked; a plain tool is not", () => {
    for (const command of [123, ["ls"], {}, false, 0]) {
      expect(classify("Bash", { command })).toMatchObject({
        level: "high",
        reason: "the command is not text",
        network: true,
      });
      expect(classify("PowerShell", { command }).network).toBe(true);
    }
    for (const input of [{}, { command: null }, { command: undefined }]) {
      expect(classify("Bash", input)).toMatchObject({
        level: "medium",
        reason: MEDIUM,
        network: false,
      });
    }
    expect(classify("Read", { file_path: "curl" }).network).toBe(false);
    expect(classify("Edit", { file_path: "a.ts" }).network).toBe(false);
    expect(classify("WebFetch", {}).network).toBe(true);
    expect(classify("WebSearch", {}).network).toBe(true);
    expect(classify("mcp__x__y", {}).network).toBe(true);
    expect(classify("opencode:x", {}).network).toBe(true);
    expect(classify("opencodex", {}).network).toBe(false);
    expect(classify("mcp_x", {}).network).toBe(false);
  });
});
