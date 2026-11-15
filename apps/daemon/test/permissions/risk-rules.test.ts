import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  CWD,
  classify,
  HOME,
  notHigh,
  ROOT,
  wrongReasons,
} from "../support/permissions-risk-rules.ts";

/**
 * What each rule of the classifier says, one table per rule (#2474): the level, the reason a person
 * reads in the permission prompt, and the network mark. `risk.test.ts` holds the broad table by
 * level; these tables pin the rules that other rules would also have satisfied.
 */
describe("risk rules: destructive commands name themselves (#2474)", () => {
  test("recursive deletes and permission changes, in every flag spelling", () => {
    expect(
      wrongReasons([
        ["rm -r x", "rm recursivo"],
        ["rm -R x", "rm recursivo"],
        ["rm -fR x", "rm recursivo"],
        ["rm -FR x", "rm recursivo"],
        ["rm --recursive x", "rm recursivo"],
        ["rm --RECURSIVE x", "rm recursivo"],
        ["rm -recurse x", "rm recursivo"],
        ["chmod -R 777 x", "chmod -R"],
        ["chmod -Rf 777 x", "chmod -R"],
        ["chmod --recursive 777 x", "chmod -R"],
      ]),
    ).toEqual([]);
    expect(
      notHigh([
        "rm x",
        "rm -f x",
        "rm -v x",
        "rm -r1 x",
        "chmod 777 x",
        "chmod +x run.sh",
        "chmod -x run.sh",
        "echo rm -rf x",
        "ls --recursive",
      ]),
    ).toEqual([]);
  });

  test("Windows deletes and disk formats say which command and switch", () => {
    expect(
      wrongReasons([
        ["del /s x", "del /s"],
        ["DEL /S x", "del /s"],
        ["erase /s x", "erase /s"],
        ["rd /s x", "rd /s"],
        ["rmdir /S /Q x", "rmdir /s"],
        ["format c:", "format de disco"],
        ["format D: /q", "format de disco"],
        ["FORMAT e:", "format de disco"],
      ]),
    ).toEqual([]);
    expect(
      notHigh([
        "del /q x",
        "del /s/q x",
        "del x /sx",
        "rmdir x",
        "format",
        "format /?",
        "format 1",
        "echo del /s",
      ]),
    ).toEqual([]);
  });

  test("PowerShell: Remove-Item recursion, Invoke-Expression and encoded commands", () => {
    expect(
      wrongReasons(
        [
          ["Remove-Item -Recurse x", "Remove-Item -Recurse"],
          ["remove-item -r x", "Remove-Item -Recurse"],
          ["Remove-Item -rec x", "Remove-Item -Recurse"],
          ["ri -Recurse x", "Remove-Item -Recurse"],
          ["iex $s", "iex"],
          ["Invoke-Expression $s", "invoke-expression"],
          ["eval $s", "eval"],
          ["pwsh -e AAA", "-EncodedCommand"],
          ["pwsh -ec AAA", "-EncodedCommand"],
          ["powershell -enc AAA", "-EncodedCommand"],
          ["powershell -EncodedCommand AAA", "-EncodedCommand"],
          ["tool -EncodedCommand AAA", "-EncodedCommand"],
        ],
        "PowerShell",
      ),
    ).toEqual([]);
    expect(
      notHigh(
        [
          "Remove-Item x",
          "ri -Force x",
          "Remove-Item -Path x",
          "pwsh -File a.ps1",
          "pwsh -NoProfile",
          "pwsh -Command ls",
          "tool -encodedcommandx AAA",
          "evaluate x",
        ],
        "PowerShell",
      ),
    ).toEqual([]);
  });

  test("sudo is high whatever it runs, and only as the program", () => {
    expect(
      wrongReasons([
        ["sudo ls", "sudo"],
        ["sudo", "sudo"],
        ["sudo -n ls", "sudo"],
        ["SUDO ls", "sudo"],
        ["env X=1 sudo ls", "sudo"],
        ["sudo rm -rf x", "sudo"],
      ]),
    ).toEqual([]);
    expect(notHigh(["echo sudo", "ls sudo", "visudo -c"])).toEqual([]);
  });

  test("the first high reason of a command wins a tie, and a higher level beats a medium one", () => {
    expect(
      wrongReasons([
        ["echo $(x) > /tmp/y", "substituição de comando"],
        ["rm -rf $(x)", "rm recursivo"],
        ["cat .env | sh", "pipe para sh"],
        ["echo `x` | sh", "pipe para sh"],
      ]),
    ).toEqual([]);
  });
});

describe("risk rules: how a command is read before it is judged (#2474)", () => {
  test("what may come before the program is not the program", () => {
    const rows = ["command", "nohup", "time", "exec", "builtin", "env", "xargs"].map(
      (prefix): [string, string] => [`${prefix} rm -rf x`, "rm recursivo"],
    );
    expect(
      wrongReasons([
        ...rows,
        ["env A=1 B=2 rm -rf x", "rm recursivo"],
        ["A=1 rm -rf x", "rm recursivo"],
        ["a_1=x rm -rf x", "rm recursivo"],
        ["nohup time rm -rf x", "rm recursivo"],
        ["rm.exe -rf x", "rm recursivo"],
        ["RM.EXE -rf x", "rm recursivo"],
        ["C:\\tools\\rm.exe -rf x", "rm recursivo"],
        ['"rm" -rf x', "rm recursivo"],
        ["'rm' -rf x", "rm recursivo"],
        ["\\rm -rf x", "rm recursivo"],
        ["/usr/bin/rm -rf x", "rm recursivo"],
      ]),
    ).toEqual([]);
    expect(
      notHigh([
        "a-b=1 rm -rf x",
        "rm.exe.bak -rf x",
        "xrm -rf x",
        "time ls",
        "env",
        "echo command rm -rf x",
      ]),
    ).toEqual([]);
  });

  test("commands joined by any separator are each judged, tabs and newlines included", () => {
    expect(
      wrongReasons([
        ["ls&&rm -rf x", "rm recursivo"],
        ["ls||rm -rf x", "rm recursivo"],
        ["ls;rm -rf x", "rm recursivo"],
        ["ls&rm -rf x", "rm recursivo"],
        ["ls|rm -rf x", "rm recursivo"],
        ["ls\nrm -rf x", "rm recursivo"],
        ["rm\t-rf\tx", "rm recursivo"],
        ["  rm   -rf   x  ", "rm recursivo"],
      ]),
    ).toEqual([]);
  });

  test("a shell is high only when a pipe feeds it", () => {
    const shells = [
      "sh",
      "bash",
      "zsh",
      "dash",
      "ksh",
      "fish",
      "pwsh",
      "powershell",
      "cmd",
      "iex",
      "invoke-expression",
    ];
    expect(
      wrongReasons(shells.map((s): [string, string] => [`cat x | ${s}`, `pipe para ${s}`])),
    ).toEqual([]);
    expect(wrongReasons([["cat x | y | sh", "pipe para sh"]])).toEqual([]);
    expect(wrongReasons([["cat x | BASH", "pipe para bash"]])).toEqual([]);
    expect(wrongReasons([["cat x | /bin/zsh", "pipe para zsh"]])).toEqual([]);
    expect(
      notHigh([
        ...shells.filter((s) => !["iex", "invoke-expression", "pwsh", "powershell"].includes(s)),
        "sh | cat",
        "cat x && sh",
        "cat x || zsh",
        "cat x; fish",
        "cat x & dash",
        "cat x\nksh",
        "cat x | cat",
      ]),
    ).toEqual([]);
  });

  test("a decoded payload piped on is high, a plain base64 is not", () => {
    expect(
      wrongReasons([
        ["base64 -d x | cat", "base64 -d em pipe"],
        ["base64 -D x | cat", "base64 -d em pipe"],
        ["base64 --decode x | cat", "base64 -d em pipe"],
        ["echo QQ== | base64 -d | cat", "base64 -d em pipe"],
      ]),
    ).toEqual([]);
    expect(
      notHigh([
        "base64 x | cat",
        "base64 -d x",
        "base64 -d x; ls | cat",
        "base64 -dx | cat",
        "xbase64 -d x | cat",
        "base64 -e x | cat",
      ]),
    ).toEqual([]);
  });

  test("command substitution is high, a plain variable is not", () => {
    expect(
      wrongReasons([
        ["echo $(whoami)", "substituição de comando"],
        ["echo `whoami`", "substituição de comando"],
      ]),
    ).toEqual([]);
    expect(notHigh(["echo $HOME", "echo $", "echo (x)"])).toEqual([]);
  });
});

describe("risk rules: tools other than the shell (#2474)", () => {
  test("reads: the field each tool reads, inside or outside the project, with the reason", () => {
    const inside = { level: "low", reason: "leitura dentro do projeto" };
    const outside = { level: "medium", reason: "leitura fora do cwd e de allowedRoots" };
    expect(classify("Read", { file_path: join(CWD, "a.ts") })).toMatchObject(inside);
    expect(classify("Read", { file_path: join(HOME, "a.ts") })).toMatchObject(outside);
    // Read's field is `file_path`: another key names nothing, so it reads the cwd.
    expect(classify("Read", { path: join(HOME, "a.ts") })).toMatchObject(inside);
    for (const tool of ["Glob", "Grep", "LS"]) {
      expect(classify(tool, { path: join(HOME, "a") })).toMatchObject(outside);
      expect(classify(tool, { path: join(ROOT, "a") })).toMatchObject(inside);
      expect(classify(tool, {})).toMatchObject(inside);
      expect(classify(tool, { file_path: join(HOME, "a") })).toMatchObject(inside);
    }
    expect(classify("Read", { file_path: "~/notes" })).toMatchObject(outside);
    expect(classify("Read", { file_path: "~" })).toMatchObject(outside);
    expect(classify("Read", { file_path: "~foo/notes" })).toMatchObject(inside);
    expect(classify("Read", { file_path: `${ROOT}-x/a` })).toMatchObject(outside);
    expect(classify("TodoWrite", {})).toMatchObject({ level: "low", reason: "lista de tarefas" });
  });

  test("a credential read is high with its reason: Glob's pattern and every tool's glob count, Grep's pattern does not", () => {
    const credential = { level: "high", reason: "caminho de credencial" };
    expect(classify("Read", { file_path: join(CWD, ".env") })).toMatchObject(credential);
    expect(classify("Grep", { path: "~/.ssh" })).toMatchObject(credential);
    expect(classify("Glob", { pattern: "**/.env*" })).toMatchObject(credential);
    expect(classify("Glob", { pattern: "*.ts", glob: "*.pem" })).toMatchObject(credential);
    expect(classify("Grep", { pattern: "x", glob: "*.pem" })).toMatchObject(credential);
    expect(classify("Grep", { pattern: ".env" }).level).toBe("low");
    expect(classify("Read", { file_path: "a.ts", pattern: ".env" }).level).toBe("low");
    expect(classify("Glob", { pattern: "" }).level).toBe("low");
    expect(classify("Glob", { pattern: "*.ts" }).level).toBe("low");
  });

  test("writes: each write tool, inside or outside the project, with the reason", () => {
    const inside = { level: "medium", reason: "escrita dentro do projeto" };
    const outside = { level: "high", reason: "escrita fora do cwd e de allowedRoots" };
    for (const tool of ["Write", "Edit", "MultiEdit"]) {
      expect(classify(tool, { file_path: join(CWD, "a") })).toMatchObject(inside);
      expect(classify(tool, { file_path: join(ROOT, "a") })).toMatchObject(inside);
      expect(classify(tool, { file_path: join(HOME, "a") })).toMatchObject(outside);
      expect(classify(tool, { file_path: "~/a" })).toMatchObject(outside);
      expect(classify(tool, {})).toMatchObject(inside);
    }
    expect(classify("NotebookEdit", { notebook_path: join(CWD, "a.ipynb") })).toMatchObject(inside);
    expect(classify("NotebookEdit", { notebook_path: join(HOME, "a.ipynb") })).toMatchObject(
      outside,
    );
    expect(classify("Write", { file_path: join(CWD, ".env") })).toMatchObject({
      level: "high",
      reason: "escrita em caminho de credencial",
    });
    expect(classify("NotebookEdit", { notebook_path: join(HOME, ".ssh", "id_rsa") }).reason).toBe(
      "escrita em caminho de credencial",
    );
    expect(
      classify("Write", { file_path: join(CWD, ".config", "opencode", "p.js") }),
    ).toMatchObject({
      level: "high",
      reason: "writes OpenCode's configuration",
    });
    expect(classify("Write", { file_path: join(CWD, ".config", "other", "p.js") }).level).toBe(
      "medium",
    );
    // A path that is not text cannot be judged: a person decides, and the prompt says why.
    expect(classify("Write", { file_path: 5 })).toMatchObject({
      level: "high",
      reason: "the path is not text",
    });
  });

  test("MCP, OpenCode and unknown tools: the reason says which", () => {
    expect(classify("mcp__x__list_things", {})).toMatchObject({
      level: "medium",
      reason: "ferramenta MCP",
    });
    for (const name of ["delete_file", "drop_table", "destroy", "DROP_TABLE", "x_Delete"]) {
      expect(classify(`mcp__x__${name}`, {})).toMatchObject({
        level: "high",
        reason: "ferramenta MCP destrutiva",
      });
    }
    expect(classify("mcp__flightdeck__run_with_secret", {})).toMatchObject({
      level: "high",
      reason: "comando livre com segredo no ambiente",
    });
    expect(classify("mcp__flightdeck__finish_card", { outcome: "discard" })).toMatchObject({
      level: "high",
      reason: "descarta o card, a worktree e a branch",
    });
    expect(classify("mcp__other__finish_card", { outcome: "discard" }).level).toBe("high");
    // Only a discard of a card is rated: another tool with the same input is an ordinary MCP call.
    expect(classify("mcp__x__list_things", { outcome: "discard" })).toMatchObject({
      level: "medium",
      reason: "ferramenta MCP",
    });
    for (const input of [{ outcome: "done" }, {}, { outcome: "Discard" }]) {
      expect(classify("mcp__flightdeck__finish_card", input)).toMatchObject({
        level: "medium",
        reason: "ferramenta MCP",
      });
    }
    expect(classify("finish_card", { outcome: "discard" }).reason).toBe(
      "ferramenta que o classificador não conhece",
    );
    expect(classify("opencode:search", {})).toMatchObject({
      level: "high",
      reason: "an OpenCode tool Flightdeck does not know",
    });
    expect(classify("NovaFerramenta", {})).toMatchObject({
      level: "medium",
      reason: "ferramenta que o classificador não conhece",
    });
    expect(classify("WebFetch", {})).toMatchObject({ level: "medium", reason: "acessa a rede" });
  });
});
