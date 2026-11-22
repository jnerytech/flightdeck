import { describe, expect, test } from "bun:test";
import { AssistantResult } from "@flightdeck/protocol";
import type { DemoIds } from "../../demo-seed.ts";
import {
  type AssistantMode,
  assistantRewriter,
  assistantScript,
} from "../../lib/shots/assistant-frames.ts";
import { assistantShots, demoAssistantPrefs } from "../../lib/shots/table-assistant.ts";

const IDS = { idleSession: "idle-1" } as DemoIds;
const named = (name: string) => assistantShots(IDS).find((shot) => shot.name === name);

/** What the app sends for a wand click, and what the demo host would answer to the command it is retyped as. */
const request = JSON.stringify({ id: "q1", type: "assistant.run", payload: { requestId: "r1" } });
const hostAck = JSON.stringify({ id: "q1", type: "ack", ok: true, data: { version: "x" } });

/** The page's side of one wand request: the frame the host gets, and what the app hears back. */
function run(mode: AssistantMode) {
  const rewriter = assistantRewriter(mode);
  const sent = JSON.parse(rewriter.fromApp(request)) as { type: string; id: string };
  return {
    sent,
    dropped: rewriter.drops?.(hostAck) === true,
    heard: JSON.parse(rewriter.fromHost(hostAck)) as Record<string, unknown>,
  };
}

describe("the AI assistant prints (#4168)", () => {
  test("the table prints the settings states, then the wand's states on a session", () => {
    expect(assistantShots(IDS).map((shot) => shot.name)).toEqual([
      "configuracoes-assistente",
      "configuracoes-assistente-avancado",
      "configuracoes-assistente-confirmar",
      "configuracoes-assistente-aviso",
      "assistente-varinha-vazia",
      "assistente-executando",
      "assistente-sugestao",
      "assistente-sugestao-avisos",
      "assistente-falhou",
      "assistente-desfazer",
    ]);
  });

  test("the settings prints open Settings on the assistant; the notice print starts on the session whose wand sends the person there", () => {
    expect(
      ["configuracoes-assistente", "configuracoes-assistente-avancado"].map(
        (name) => named(name)?.route,
      ),
    ).toEqual([
      { name: "settings", section: "assistant" },
      { name: "settings", section: "assistant" },
    ]);
    expect(named("configuracoes-assistente-confirmar")?.route).toEqual({
      name: "settings",
      section: "assistant",
    });
    expect(named("configuracoes-assistente-aviso")?.route).toEqual({
      name: "session",
      host: "demo-alfa",
      id: "idle-1",
    });
  });

  test("only the prints that need a set-up assistant seed one; the confirm and notice prints start with none", () => {
    const seeded = assistantShots(IDS)
      .filter((shot) => shot.assistantReady === true)
      .map((shot) => shot.name);
    expect(seeded).toEqual([
      "configuracoes-assistente",
      "configuracoes-assistente-avancado",
      "assistente-varinha-vazia",
      "assistente-executando",
      "assistente-sugestao",
      "assistente-sugestao-avisos",
      "assistente-falhou",
      "assistente-desfazer",
    ]);
  });

  test("each wand print answers the request the way its state needs", () => {
    expect(
      ["executando", "sugestao", "sugestao-avisos", "falhou", "desfazer"].map(
        (suffix) => named(`assistente-${suffix}`)?.assistant,
      ),
    ).toEqual(["pending", "answers", "notices", "refuses", "answers"]);
    expect(named("assistente-varinha-vazia")?.assistant).toBeUndefined();
  });

  test("the stored preferences name the demo host as confirmed and hold no key of any kind", () => {
    const prefs = JSON.parse(demoAssistantPrefs()) as Record<string, unknown>;
    expect(prefs).toMatchObject({
      version: 1,
      enabled: true,
      provider: "host",
      hostId: "demo-alfa",
      confirmedHosts: ["demo-alfa"],
    });
    expect(demoAssistantPrefs()).not.toMatch(/sk-|key|token|secret/i);
  });

  test("a wand request goes to the host as a command that cannot start Claude, and the app hears a suggestion", () => {
    const { sent, heard } = run("answers");
    expect({ type: sent.type, id: sent.id, ok: heard.ok, id2: heard.id }).toEqual({
      type: "host.info",
      id: "q1",
      ok: true,
      id2: "q1",
    });
    expect(AssistantResult.safeParse(heard.data).success).toBe(true);
  });

  test("the answers differ: one line, then several lines with notes", () => {
    type Said = { text?: string; notices?: string[] } | undefined;
    const one = run("answers").heard.data as Said;
    const many = run("notices").heard.data as Said;
    expect({
      oneLine: one?.text?.includes("\n"),
      oneNotices: one?.notices,
      manyLines: many?.text?.includes("\n"),
      manyNotices: many?.notices?.length,
    }).toEqual({ oneLine: false, oneNotices: [], manyLines: true, manyNotices: 2 });
    expect(AssistantResult.safeParse(many).success).toBe(true);
  });

  test("a refusal is the host's own reason, so the app words it itself", () => {
    const { heard, dropped } = run("refuses");
    expect({ dropped, heard }).toEqual({
      dropped: false,
      heard: {
        id: "q1",
        type: "ack",
        ok: false,
        error: {
          code: "failed",
          message: "Claude Code on the host cannot answer.",
          reason: "assistant_host_unavailable",
          params: { detail: "it is not signed in" },
        },
      },
    });
  });

  test("a pending request is never answered: the host's ack is hidden, so the wand keeps running", () => {
    expect(run("pending").dropped).toBe(true);
    expect(run("answers").dropped).toBe(false);
  });

  test("what is not a wand request passes as it was, and so does an ack nobody asked for", () => {
    const rewriter = assistantRewriter("answers");
    const other = JSON.stringify({ id: "q2", type: "project.list", payload: {} });
    const stray = JSON.stringify({ id: "q9", type: "ack", ok: true, data: 1 });
    expect([
      rewriter.fromApp(other),
      rewriter.fromHost(stray),
      rewriter.fromApp("not json"),
    ]).toEqual([other, stray, "not json"]);
  });

  test("a failed ack of the retyped command is let through, not made a suggestion", () => {
    const rewriter = assistantRewriter("answers");
    const sent = JSON.parse(rewriter.fromApp(request)) as { type: string };
    const failed = JSON.stringify({ id: "q1", type: "ack", ok: false, error: { code: "x" } });
    expect([sent.type, rewriter.fromHost(failed)]).toEqual(["host.info", failed]);
  });

  test("no print holds anything shaped like a key", () => {
    const everything = JSON.stringify([
      (["answers", "notices", "refuses", "pending"] as const).map((mode) => run(mode).heard),
      assistantShots(IDS).map((shot) => [shot.name, shot.assistant, shot.assistantReady]),
      demoAssistantPrefs(),
    ]);
    // What is searched holds the answers, the refusal, the table and the prefs, so a clean result means something.
    expect(everything).toContain("assistant_host_unavailable");
    expect(everything).toContain("assistente-falhou");
    expect(everything).not.toMatch(/sk-|AKIA|[A-Za-z0-9]{32,}/);
  });

  test("the rewriter's source stands alone, as an init script carries it", () => {
    const source = assistantScript("answers");
    const page = { WebSocket: class {} as unknown as typeof WebSocket };
    new Function("window", source)(page);
    expect([source.length > 0, page.WebSocket.name]).toEqual([true, "Held"]);
  });
});
