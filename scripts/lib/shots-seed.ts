import type { FinishedState } from "../../apps/desktop/src/lib/finished.ts";

/** The request the bell's print answers: the host that holds it and the id the daemon gave it. */
export interface LiveRequest {
  hostId: string;
  requestId: string;
}

/** The notifications of the bell's print: today in UTC (the prints' zone), and one three days ago. */
export function demoInbox(lang: string, _request: LiveRequest | null): string {
  const pt = lang.startsWith("pt");
  const dayStart = new Date().setUTCHours(0, 0, 0, 0);
  const today = (second: number) => new Date(dayStart + second * 1000).toISOString();
  const earlier = new Date(dayStart - 3 * 86_400_000 + 12 * 3_600_000).toISOString();
  const need = pt ? "Precisa de você" : "Needs you";
  const ask = (question: string) => (pt ? `Pergunta: ${question}` : `Asks: ${question}`);
  const entry = (id: string, at: string, extra: Record<string, unknown>) => ({
    id,
    at,
    title: need,
    body: "",
    read: false,
    ...extra,
  });
  return JSON.stringify([
    entry("1", today(300), {
      subject: "api · refactor",
      host: "alfa",
      ask: ask(pt ? "qual banco usar?" : "which DB to use?"),
      group: "alfa/api",
    }),
    entry("2", today(240), {
      subject: "api · refactor",
      host: "alfa",
      ask: ask(pt ? "devo migrar agora?" : "migrate now?"),
      group: "alfa/api",
    }),
    entry("3", today(180), {
      subject: "api · refactor",
      host: "alfa",
      ask: ask(pt ? "qual esquema?" : "which schema?"),
      group: "alfa/api",
    }),
    entry("4", today(120), {
      subject: "web · tests",
      host: "alfa",
      ask: pt ? "Quer executar: bun test" : "Wants to run: bun test",
      group: "alfa/web",
    }),
    entry("5", today(60), {
      title: pt ? "Card desbloqueado" : "Card unblocked",
      subject: "Card B",
      host: "alfa",
      ask: pt ? "Quer alterar main.ts" : "Wants to change main.ts",
      route: { name: "card", host: "demo-alfa", projectId: "gone", cardId: "gone" },
    }),
    entry("6", today(30), {
      subject: "docs · notes",
      host: "alfa",
      body: pt ? "ociosa" : "idle",
      read: true,
    }),
    entry("7", earlier, {
      title: pt ? "Orçamento" : "Budget",
      body: "alfa · 80%",
      read: true,
    }),
  ]);
}

/** What the Needs you prints start with: two sessions that finished after the last look. */
export function demoFinished(
  _hostId: string,
  _sessions: { done: { id: string; name: string }; failed: { id: string; name: string } },
  _now: Date,
): string {
  const state: FinishedState = { list: [], lastLook: null };
  return JSON.stringify(state);
}
