/** What the prints seed into the page's storage: the bell's notifications and the Finished list. */

import { requestLink } from "../../../apps/desktop/src/features/inbox/domain/request-link.ts";
import type { Finish } from "../../../apps/desktop/src/features/sessions/domain/finished-list.ts";

/**
 * The notifications of the bell's print: today in UTC (the prints' zone), and one three days ago.
 * `request` is a request really open in the demo: the "web · tests" row links to it.
 */
export function demoInbox(
  lang: string,
  request?: { hostId: string; requestId: string },
  _danger?: { hostId: string; requestId: string },
): string {
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
      // A link to an open request is what makes the row answerable from the bell (#1131).
      ...(request ? { link: requestLink(request.hostId, request.requestId) } : {}),
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

/** The Finished list of the Needs you print: one session that ended its turn a few minutes ago. */
export function demoFinished(
  session: { hostId: string; sessionId: string; name: string },
  now: Date,
): string {
  const finish: Finish = {
    key: `${session.hostId}/${session.sessionId}`,
    ...session,
    outcome: "ended",
    at: now.toISOString(),
    files: null,
  };
  return JSON.stringify({ list: [finish], lastLook: null });
}

/** The instant the vault's prints are drawn at: fixed, so a print's "last used" never changes between runs. */
const DEMO_VAULT_NOW = Date.parse("2026-11-20T12:00:00Z");

const hoursAgo = (hours: number) => DEMO_VAULT_NOW - hours * 3_600_000;

/**
 * The vault's list of the prints (#3602): one secret of each type, so the rows differ, allowed on
 * `hostId`. Only the list: the web build keeps values in memory, so no secret has one and no value
 * is ever on a print.
 */
export function demoSecrets(hostId: string): string {
  const secret = (id: string, name: string, type: string, extra = {}) => ({
    id: `demo-secret-${id}`,
    name,
    type,
    description: "",
    tags: [],
    createdAt: hoursAgo(24 * 30),
    lastUsedAt: null,
    allowedHosts: [hostId],
    ...extra,
  });
  return JSON.stringify([
    secret("1", "github-deploy", "ssh-key", { tags: ["ci"], lastUsedAt: hoursAgo(2) }),
    secret("2", "npm-publish", "token", { tags: ["ci"] }),
    secret("3", "staging-db", "password", { lastUsedAt: hoursAgo(72) }),
    secret("4", "web-env", "env", { tags: ["web"], lastUsedAt: hoursAgo(26) }),
  ]);
}

/** The vault's usage log of the prints: what `demoSecrets` asked for, one line each kind. No value. */
export function demoVaultUsage(hostId: string): string {
  const line = (
    n: string,
    kind: string,
    hours: number,
    purpose: string,
    detail: string,
    requester: string,
  ) => ({
    secretId: `demo-secret-${n}`,
    hostId,
    purpose,
    requester,
    at: hoursAgo(hours),
    kind,
    detail,
  });
  return JSON.stringify([
    line("1", "delivered", 2, "git push", "", "you"),
    line("4", "delivered", 26, "deploy", "", "claude"),
    line("2", "denied", 30, "publish", "not allowed on this host", "automation"),
    line("3", "delivered", 50, "release", "", "workflow"),
  ]);
}
