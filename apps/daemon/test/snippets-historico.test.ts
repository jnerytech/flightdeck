import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Snippet } from "@flightdeck/protocol";
import { startServer } from "../src/server.ts";
import { defaultHistorySources, HistoryImporter } from "../src/snippets/history.ts";
import { SecretScanner } from "../src/snippets/model.ts";
import { Snippets } from "../src/snippets/store.ts";
import { EventStore } from "../src/store/event-store.ts";
import { newManager, tempDir, workspace } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "snippets-history-token-0123456789abc";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

// Secrets made for the tests, built here so no file of the repository holds one.
const GITHUB = `ghp_${"0123456789abcdef".repeat(2)}0123`;
const BEARER = `Bearer ${"abcdefghij".repeat(3)}`;
const AWS = `AKIA${"0123456789ABCDEF"}`;
const SK = `sk-proj-${"0123456789abcdef".repeat(2)}`;

const BASH = [
  "#1700000000",
  "git status",
  "#1700000001",
  "git status",
  "git status",
  "bun test",
  "bun test",
  "ls",
  "cd ..",
  "docker compose up -d",
  `export GITHUB_TOKEN=${GITHUB}`,
  `curl -H "Authorization: ${BEARER}" https://api.example.com`,
  "mysql -u root password=hunter2hunter2",
  "",
].join("\n");

const ZSH = [
  ": 1700000000:0;git status",
  ": 1700000001:0;bun test",
  ": 1700000002:0;kubectl get pods \\",
  "-n prod",
  `: 1700000003:0;aws configure set aws_access_key_id ${AWS}`,
  "docker compose up -d",
  "",
].join("\n");

const POWERSHELL = [
  "﻿Get-ChildItem -Recurse",
  "git status",
  "docker ps `",
  "  -a",
  `$env:OPENAI_API_KEY="${SK}"`,
  "",
].join("\r\n");

function setup(
  files: { bash?: string; zsh?: string; psreadline?: string } = {
    bash: BASH,
    zsh: ZSH,
    psreadline: POWERSHELL,
  },
  scanner = new SecretScanner(),
) {
  const dir = tempDir();
  const sources: { bash?: string; zsh?: string; psreadline?: string } = {};
  for (const [shell, content] of Object.entries(files)) {
    const path = join(dir, shell);
    writeFileSync(path, content);
    sources[shell as keyof typeof sources] = path;
  }
  const { root, project } = workspace();
  const snippets = new Snippets({
    db: new EventStore(":memory:").db,
    allowedRoots: [root],
    scanner,
  });
  const importer = new HistoryImporter({ sources, scanner, snippets });
  return { dir, sources, snippets, importer, root, project };
}

const commands = (candidates: Array<{ command: string | null }>) =>
  candidates.map((c) => c.command);

describe("snippets-historico: ler os históricos", () => {
  test("bash: as linhas de data do HISTTIMEFORMAT não contam, e os comandos triviais ficam de fora", () => {
    const { importer } = setup({ bash: BASH });
    const { candidates } = importer.preview({});
    expect(
      candidates.filter((c) => c.selectable).map((c) => [c.command, c.count, c.shells]),
    ).toEqual([
      ["git status", 3, ["bash"]],
      ["bun test", 2, ["bash"]],
      ["docker compose up -d", 1, ["bash"]],
    ]);
    expect(commands(candidates)).not.toContain("ls");
    expect(commands(candidates)).not.toContain("cd ..");
  });

  test("zsh: o formato estendido e o simples, e o comando em várias linhas (com barra no fim) não é candidato", () => {
    const { importer } = setup({ zsh: ZSH });
    const { candidates } = importer.preview({});
    expect(candidates.filter((c) => c.selectable).map((c) => [c.command, c.shells])).toEqual([
      ["bun test", ["zsh"]],
      ["docker compose up -d", ["zsh"]],
      ["git status", ["zsh"]],
    ]);
    expect(JSON.stringify(candidates)).not.toContain("kubectl");
  });

  test("PSReadLine: o BOM sai, as linhas CRLF valem, e a continuação com crase não é candidata", () => {
    const { importer } = setup({ psreadline: POWERSHELL });
    const { candidates } = importer.preview({});
    expect(candidates.filter((c) => c.selectable).map((c) => [c.command, c.shells])).toEqual([
      ["Get-ChildItem -Recurse", ["powershell"]],
      ["git status", ["powershell"]],
    ]);
    expect(JSON.stringify(candidates)).not.toContain("docker ps");
  });

  test("os três juntos: a contagem soma, as origens se listam e a ordem é por frequência e depois por texto", () => {
    const { importer } = setup();
    const { candidates, sources } = importer.preview({});
    expect(
      candidates.filter((c) => c.selectable).map((c) => [c.command, c.count, c.shells]),
    ).toEqual([
      ["git status", 5, ["bash", "zsh", "powershell"]],
      ["bun test", 3, ["bash", "zsh"]],
      ["docker compose up -d", 2, ["bash", "zsh"]],
      ["Get-ChildItem -Recurse", 1, ["powershell"]],
    ]);
    expect(sources).toEqual([
      { shell: "bash", found: true },
      { shell: "zsh", found: true },
      { shell: "powershell", found: true },
    ]);
    // Only the most used ones, as many as asked for.
    const top = importer.preview({ limit: 2 }).candidates;
    expect(top).toHaveLength(2);
    expect(commands(top)).toEqual(["git status", "bun test"]);
  });

  test("um histórico que não existe é só uma origem sem arquivo", () => {
    const { importer, dir } = setup({ bash: BASH });
    const missing = new HistoryImporter({
      sources: { bash: join(dir, "bash"), zsh: join(dir, "nao-existe") },
      scanner: new SecretScanner(),
      snippets: new Snippets({
        db: new EventStore(":memory:").db,
        allowedRoots: [dir],
        scanner: new SecretScanner(),
      }),
    });
    expect(missing.preview({}).sources).toEqual([
      { shell: "bash", found: true },
      { shell: "zsh", found: false },
    ]);
    expect(importer.preview({}).sources).toEqual([{ shell: "bash", found: true }]);
  });

  test("só leitura: os arquivos e a pasta ficam como estavam, antes e depois de importar", () => {
    const { importer, sources, dir } = setup();
    const snapshot = () => ({
      files: Object.values(sources).map((path) => [
        readFileSync(path as string, "utf8"),
        statSync(path as string).mtimeMs,
      ]),
      tree: readdirSync(dir).sort(),
    });
    const before = snapshot();
    const { candidates } = importer.preview({});
    importer.import([candidates[0]?.id ?? ""]);
    expect(snapshot()).toEqual(before);
  });

  test("um histórico enorme é lido só pelo final, sem a linha cortada no começo", () => {
    const filler = `${"x".repeat(99)}\n`;
    const text = `early command only once\n${filler.repeat(53_000)}late command twice\nlate command twice\n`;
    const { importer } = setup({ bash: text });
    const { candidates } = importer.preview({});
    expect(commands(candidates)).toContain("late command twice");
    expect(commands(candidates)).not.toContain("early command only once");
    // The line the cut fell in the middle of is not taken for a command.
    expect(
      candidates.every(
        (c) =>
          (c.command ?? "").length === 0 ||
          c.command === "late command twice" ||
          c.command === "x".repeat(99),
      ),
    ).toBe(true);
  });
});

describe("snippets-historico: varredura de segredos", () => {
  test("a linha com segredo fica oculta e não selecionável, com o tipo e sem o valor", () => {
    const { importer } = setup();
    const { candidates } = importer.preview({});
    const flagged = candidates.filter((c) => c.hidden);
    expect(flagged.map((c) => c.flagged.join(" + ")).sort()).toEqual(
      ["chave da AWS", "chave sk-", "senha na linha", "token Bearer", "token do GitHub"].sort(),
    );
    for (const candidate of flagged) {
      expect(candidate).toMatchObject({ command: null, selectable: false });
      expect(candidate.count).toBeGreaterThan(0);
    }
    // Neither the preview nor its labels carry a secret.
    const text = JSON.stringify(candidates);
    for (const secret of [GITHUB, BEARER, AWS, SK, "hunter2hunter2"])
      expect(text).not.toContain(secret);
    expect(
      candidates.filter((c) => !c.hidden).every((c) => c.selectable && c.flagged.length === 0),
    ).toBe(true);
  });

  test("revelar mostra o texto, mas a linha continua sem poder ser importada", () => {
    const { importer, snippets } = setup();
    const revealed = importer
      .preview({ reveal: true })
      .candidates.filter((c) => c.flagged.length > 0);
    expect(revealed).toHaveLength(5);
    expect(revealed.every((c) => c.command !== null && !c.selectable && c.hidden === false)).toBe(
      true,
    );
    const result = importer.import(revealed.map((c) => c.id));
    expect(result.created).toEqual([]);
    expect(result.skipped.map((s) => s.reason)).toEqual(Array(5).fill("marcada como segredo"));
    expect(snippets.list({}).snippets).toEqual([]);
  });

  test("um valor do cofre na linha também marca, pelo ponto de extensão do scanner", () => {
    const vaulted = new SecretScanner(() => ["correct-horse-battery"]);
    const { importer } = setup(
      { bash: "ssh deploy@host correct-horse-battery\ngit status\n" },
      vaulted,
    );
    const { candidates } = importer.preview({});
    expect(candidates.map((c) => [c.command, c.flagged])).toEqual([
      ["git status", []],
      [null, ["valor do cofre"]],
    ]);
  });
});

describe("snippets-historico: importar", () => {
  test("os escolhidos viram snippets de comando do host, com nome próprio e a tag histórico", () => {
    const { importer, snippets, project } = setup();
    const { candidates } = importer.preview({});
    const pick = (command: string) => candidates.find((c) => c.command === command)?.id ?? "";
    const result = importer.import([
      pick("git status"),
      pick("docker compose up -d"),
      pick("Get-ChildItem -Recurse"),
    ]);
    expect(result.skipped).toEqual([]);
    expect(result.created.map((s) => [s.name, s.run, s.scope, s.source, s.type, s.tags])).toEqual([
      ["git-status", "git status", "host", "daemon", "command", ["histórico"]],
      ["docker-compose-up", "docker compose up -d", "host", "daemon", "command", ["histórico"]],
      [
        "Get-ChildItem-Recurse",
        "Get-ChildItem -Recurse",
        "host",
        "daemon",
        "command",
        ["histórico"],
      ],
    ]);
    // Never to a project's versioned file.
    expect(snippets.list({ projectPath: project }).file).toBeNull();
    expect(snippets.list({ scope: "project", projectPath: project }).snippets).toEqual([]);
  });

  test("o que não se pode importar volta com o motivo: desconhecido, repetido, ou nome já usado leva um número", () => {
    const { importer } = setup();
    const { candidates } = importer.preview({});
    const id = candidates.find((c) => c.command === "git status")?.id ?? "";
    expect(importer.import([id]).created).toHaveLength(1);
    const again = importer.import([id, "0000000000000000"]);
    expect(again.created).toEqual([]);
    expect(again.skipped).toEqual([
      { id, reason: "já existe um snippet com este comando" },
      { id: "0000000000000000", reason: "não está no histórico" },
    ]);
    // A different command that would get the same name.
    const other = setup({ bash: "git log --oneline\ngit log --oneline\n" });
    other.snippets.save({
      scope: "host",
      name: "git-log-oneline",
      type: "command",
      run: "git log",
    });
    const picked = other.importer.preview({}).candidates[0]?.id ?? "";
    expect(other.importer.import([picked]).created[0]?.name).toBe("git-log-oneline-2");
  });
});

describe("snippets-historico: pelo protocolo", () => {
  async function connect(
    importer: HistoryImporter | null,
    snippets: Snippets | null,
    root: string,
  ) {
    const server = startServer({
      manager: newManager().manager,
      ...(importer ? { snippetHistory: importer } : {}),
      ...(snippets ? { snippets } : {}),
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [root],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    return client;
  }

  test("snippets.importHistory dá a prévia e, com select, importa", async () => {
    const { importer, snippets, root } = setup();
    const client = await connect(importer, snippets, root);
    const preview = await client.data<{
      candidates: Array<{ id: string; command: string | null }>;
      created: Snippet[];
      skipped: unknown[];
    }>("snippets.importHistory", { limit: 5 });
    expect(preview?.candidates[0]?.command).toBe("git status");
    expect(preview?.created).toEqual([]);
    const imported = await client.data<{ created: Snippet[] }>("snippets.importHistory", {
      select: [preview?.candidates[0]?.id ?? ""],
    });
    expect(imported?.created.map((s) => s.name)).toEqual(["git-status"]);
    const bad = await client.request("snippets.importHistory", { limit: 0 });
    expect((bad.error as { code?: string } | undefined)?.code).toBe("bad_request");
  });

  test("sem o importador configurado, diz que está desativado", async () => {
    const { root } = workspace();
    const client = await connect(null, null, root);
    const ack = await client.request("snippets.importHistory", {});
    expect((ack.error as { code?: string } | undefined)?.code).toBe("invalid_state");
  });
});

describe("snippets-historico: nomes", () => {
  test("o nome vem das primeiras palavras do comando, só com o que um nome aceita, e o comando longo é cortado", () => {
    const { importer } = setup({
      bash: [
        "kubectl get pods -n prod --watch",
        "kubectl get pods -n prod --watch",
        "git commit -m 'feat: x'",
        "git commit -m 'feat: x'",
        `${"a".repeat(80)} b`,
        `${"a".repeat(80)} b`,
        "/usr/local/bin/tool --flag",
        "/usr/local/bin/tool --flag",
        "",
      ].join("\n"),
    });
    const ids = importer.preview({}).candidates.map((c) => c.id);
    const names = importer.import(ids).created.map((s) => s.name);
    expect(names.sort()).toEqual(
      ["kubectl-get-pods", "git-commit-m", "usr-local-bin-tool-flag", "a".repeat(64)].sort(),
    );
  });

  test("sem nenhuma origem configurada, não há candidatos", () => {
    expect(setup({}).importer.preview({})).toEqual({ candidates: [], sources: [] });
  });
});

describe("snippets-historico: onde ficam os históricos", () => {
  test("no Windows o PSReadLine fica no APPDATA, e fora dele no ~/.local/share/powershell; bash e zsh no home", () => {
    expect(
      defaultHistorySources({ home: "/home/u", appData: undefined, platform: "linux" }),
    ).toEqual({
      bash: join("/home/u", ".bash_history"),
      zsh: join("/home/u", ".zsh_history"),
      psreadline: join(
        "/home/u",
        ".local",
        "share",
        "powershell",
        "PSReadLine",
        "ConsoleHost_history.txt",
      ),
    });
    expect(
      defaultHistorySources({ home: "C:/Users/u", appData: "D:/Roaming", platform: "win32" }),
    ).toEqual({
      bash: join("C:/Users/u", ".bash_history"),
      zsh: join("C:/Users/u", ".zsh_history"),
      psreadline: join(
        "D:/Roaming",
        "Microsoft",
        "Windows",
        "PowerShell",
        "PSReadLine",
        "ConsoleHost_history.txt",
      ),
    });
    // Without APPDATA it falls back to the usual place under the home.
    expect(
      defaultHistorySources({ home: "C:/Users/u", appData: undefined, platform: "win32" })
        .psreadline,
    ).toBe(
      join(
        "C:/Users/u",
        "AppData",
        "Roaming",
        "Microsoft",
        "Windows",
        "PowerShell",
        "PSReadLine",
        "ConsoleHost_history.txt",
      ),
    );
  });
});
