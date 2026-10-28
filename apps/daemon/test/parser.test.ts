import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_TEXT_BYTES, parseLine, parseLines, truncateUtf8 } from "../src/history/parser.ts";

const fixture = (name: string) =>
  readFileSync(join(import.meta.dir, "fixtures", "history", name), "utf8");

describe("parser", () => {
  test("cada tipo conhecido vira um registro normalizado", () => {
    const { records, errors } = parseLines(fixture("known-types.jsonl"));
    expect(errors).toBe(0);
    const cwd = "/home/dev/projeto-a";
    expect(records).toEqual([
      {
        uuid: "u-0001",
        ts: "2026-09-01T10:00:00.000Z",
        role: "user",
        kind: "message",
        text: "Como eu configuro o flamingo azul?",
        cwd,
      },
      {
        uuid: "a-0002",
        ts: "2026-09-01T10:00:05.000Z",
        role: "assistant",
        kind: "message",
        // Thinking is dropped; each tool call becomes one `[ferramenta Nome]` line.
        text: "Vou olhar o arquivo de configuração.\n[ferramenta Read]",
        cwd,
      },
      {
        // Tool results never become searchable text.
        uuid: "u-0003",
        ts: "2026-09-01T10:00:06.000Z",
        role: "user",
        kind: "tool_result",
        text: "",
        cwd,
      },
      {
        uuid: "a-0004",
        ts: "2026-09-01T10:00:09.000Z",
        role: "assistant",
        kind: "message",
        text: "O flamingo azul fica em `config.json`.",
        cwd,
      },
      {
        uuid: "u-0005",
        ts: "2026-09-01T10:01:00.000Z",
        role: "user",
        kind: "message",
        text: "Obrigado, e a cor?",
        cwd,
      },
      {
        uuid: "s-0006",
        ts: "2026-09-01T10:02:00.000Z",
        role: "system",
        kind: "system",
        text: "Conversa compactada",
        cwd,
      },
      {
        // Summaries carry no uuid, timestamp nor cwd of their own.
        uuid: "summary:a-0004",
        ts: null,
        role: "summary",
        kind: "summary",
        text: "Configurar o flamingo azul",
        cwd: null,
      },
    ]);
  });

  test("tipo desconhecido é guardado cru; linha inválida conta erro e não derruba", () => {
    const text = fixture("unknown-and-invalid.jsonl");
    const lines = text.split("\n");
    const { records, errors } = parseLines(text);
    expect(errors).toBe(2);
    expect(records.map((r) => [r.kind, r.uuid.startsWith("raw:") ? "raw:*" : r.uuid])).toEqual([
      ["raw", "raw:*"],
      ["message", "u-1001"],
      ["raw", "raw:*"],
      ["raw", "q-1002"],
      ["message", "a-1003"],
    ]);
    const [snapshot, , number, queue, last] = records;
    expect(snapshot?.text).toBe(lines[0] ?? "");
    expect(snapshot?.role).toBeNull();
    expect(number?.text).toBe("42");
    expect(queue).toEqual({
      uuid: "q-1002",
      ts: "2026-09-02T08:00:01.000Z",
      role: null,
      kind: "raw",
      text: lines[5] ?? "",
      cwd: "/home/dev/projeto-b",
    });
    expect(last?.text).toBe("linha boa depois");
    // The raw id is stable: the same line always gets the same uuid.
    expect(parseLine(lines[0] ?? "")?.uuid).toBe(snapshot?.uuid ?? "");
  });

  test("linhas vazias e CRLF; linha inválida isolada devolve null", () => {
    const line =
      '{"type":"user","message":{"role":"user","content":"oi"},"uuid":"u1","timestamp":"t"}';
    const { records, errors } = parseLines(`${line}\r\n\r\n${line}\r\n`);
    expect(errors).toBe(0);
    expect(records.map((r) => r.text)).toEqual(["oi", "oi"]);
    expect(parseLine("{quebrado")).toBeNull();
  });

  test("tipo conhecido mal formado vira registro cru em vez de quebrar", () => {
    const line = '{"type":"assistant","uuid":"a9","timestamp":"t"}';
    expect(parseLine(line)).toEqual({
      uuid: "a9",
      ts: "t",
      role: null,
      kind: "raw",
      text: line,
      cwd: null,
    });
  });

  test("cada mensagem é cortada em 8 KB sem partir caractere multibyte", () => {
    expect(MAX_TEXT_BYTES).toBe(8192);
    const accents = "é".repeat(9000);
    const cut = truncateUtf8(accents, MAX_TEXT_BYTES);
    expect(Buffer.byteLength(cut)).toBe(8192);
    expect(cut).toBe("é".repeat(4096));

    const emoji = `a${"😀".repeat(3000)}`;
    const cutEmoji = truncateUtf8(emoji, MAX_TEXT_BYTES);
    expect(Buffer.byteLength(cutEmoji)).toBe(8189);
    expect(emoji.startsWith(cutEmoji)).toBe(true);
    expect(truncateUtf8("curto", MAX_TEXT_BYTES)).toBe("curto");

    const long = JSON.stringify({
      type: "user",
      message: { role: "user", content: "x".repeat(20_000) },
      uuid: "u-long",
      timestamp: "t",
    });
    expect(parseLine(long)?.text.length).toBe(8192);
  });
});
