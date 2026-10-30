import { afterEach, describe, expect, test } from "bun:test";
import type { PersonaInput } from "@flightdeck/protocol";
import { ExternalSessions } from "../src/central/external.ts";
import { OpenSessionPersonas } from "../src/personas/open-session.ts";
import { packPersonas } from "../src/personas/pack.ts";
import { Personas } from "../src/personas/store.ts";
import { startServer } from "../src/server.ts";
import { SecretScanner } from "../src/snippets/model.ts";
import { EventStore } from "../src/store/event-store.ts";
import { newManager, poll, record, waitFor, workspace } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "personas-open-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const scanner = new SecretScanner();

const SECURITY: PersonaInput = {
  id: "seg",
  name: "Revisor de segurança",
  description: "Revisa",
  model: "claude-opus-5-5",
  effort: "high",
  tools: ["Read"],
  body: "Procure injeção e segredos expostos.",
};

function codeOf(fn: () => unknown): Promise<string> {
  return Promise.resolve()
    .then(fn)
    .then(
      () => "ok",
      (error: { code?: string }) => error.code ?? "sem código",
    );
}

/** Managed sessions, external ones with a channel, and the personas of the host. */
function setup(options: { personas?: boolean } = {}) {
  const { root, project } = workspace();
  const store = new EventStore(":memory:");
  const personas = new Personas({
    db: store.db,
    allowedRoots: [root],
    scanner,
    pack: packPersonas,
  });
  personas.save({ scope: "host", persona: SECURITY });
  personas.save({
    scope: "host",
    persona: { ...SECURITY, id: "doc", name: "Doc", body: "Escreva docs." },
  });
  const made = newManager({ store, allowedRoots: [root], personas });
  cleanups.push(() => made.manager.shutdown());
  const external = new ExternalSessions({ db: store.db, staleAfterS: 900 });
  const sentToChannel: Array<[string, string]> = [];
  let channel = true;
  const central = {
    external,
    receptor: {
      sendToLaunch: (launchId: string, text: string) => {
        sentToChannel.push([launchId, text]);
        return channel;
      },
    },
  };
  const switcher = new OpenSessionPersonas({
    ...(options.personas === false ? {} : { personas }),
    manager: made.manager,
    central: central as never,
  });
  // A terminal session opened with `flightdeckd claude`, its channel connected.
  external.apply("SessionStart", { session_id: "claude-1", cwd: project, launch_id: "L1" });
  external.setChannel("L1", true);
  external.apply("SessionStart", { session_id: "claude-2", cwd: project });
  return {
    ...made,
    root,
    project,
    store,
    personas,
    external,
    central,
    switcher,
    sentToChannel,
    cutChannel: () => {
      channel = false;
    },
  };
}

async function idleSession(s: ReturnType<typeof setup>, persona?: { id: string }) {
  const { sessionId } = s.manager.create({
    cwd: s.project,
    prompt: "oi",
    ...(persona ? { persona } : {}),
  });
  const events = record(s.manager, sessionId);
  await waitFor(() => events.statuses().includes("idle"), { label: "sessão ociosa" });
  return { sessionId, events };
}

describe("personas-sessao-aberta: gerenciada", () => {
  test("aplicar manda a mensagem de troca de papel com o corpo, registra na linha do tempo e põe o selo", async () => {
    const s = setup();
    const { sessionId, events } = await idleSession(s);
    const done = await s.switcher.apply({ sessionId, persona: { id: "seg" } });
    expect(done.persona).toMatchObject({ id: "seg", name: "Revisor de segurança" });
    expect(done.text).toMatch(/A partir de agora, atue como "Revisor de segurança"/);
    expect(done.text).toContain("Procure injeção e segredos expostos.");
    // The message went to the session, as a user message...
    const delivered = await poll(() =>
      events.find("message.user").find((e) => e.text === done.text),
    );
    expect(delivered).toBeTruthy();
    // ...and the switch is on the timeline, next to it.
    expect(events.find("persona.applied")).toEqual([
      { type: "persona.applied", persona: { id: "seg", name: "Revisor de segurança", icon: null } },
    ]);
    expect(s.manager.get(sessionId).persona).toMatchObject({ id: "seg" });
  });

  test("numa sessão aberta a persona é instrução da conversa: nada reinicia, e reabrir a sessão não a põe no system prompt", async () => {
    const s = setup();
    const { sessionId } = await idleSession(s);
    await s.switcher.apply({ sessionId, persona: { id: "seg" } });
    expect(s.runtime.starts).toHaveLength(1);
    // The model, effort and tools of the persona do not apply to a session that is already running.
    expect(s.runtime.starts[0]?.persona).toBeUndefined();
    await s.manager.close(sessionId);
    await s.manager.resume(sessionId);
    expect(s.runtime.starts).toHaveLength(2);
    expect(s.runtime.starts[1]?.persona).toBeUndefined();
    // The badge is still there: it is part of the session.
    expect(s.manager.get(sessionId).persona).toMatchObject({ id: "seg" });
  });

  test("voltar ao normal manda a mensagem de saída do papel, registra e tira o selo; sem persona aplicada, é recusado", async () => {
    const s = setup();
    const { sessionId, events } = await idleSession(s);
    expect(await codeOf(() => s.switcher.clear({ sessionId }))).toBe("invalid_state");
    await s.switcher.apply({ sessionId, persona: { id: "seg" } });
    await waitFor(() => events.statuses().filter((x) => x === "idle").length >= 2, {
      label: "segundo turno",
    });
    const done = await s.switcher.clear({ sessionId });
    expect(done.text).toMatch(
      /Saia do papel de "Revisor de segurança" e volte ao seu comportamento normal/,
    );
    expect(
      await poll(() => events.find("message.user").find((e) => e.text === done.text)),
    ).toBeTruthy();
    expect(events.find("persona.cleared")).toEqual([
      { type: "persona.cleared", persona: { id: "seg", name: "Revisor de segurança", icon: null } },
    ]);
    expect(s.manager.get(sessionId).persona).toBeUndefined();
  });

  test("numa sessão aberta com uma persona, aplicar outra troca o selo e voltar ao normal devolve o da abertura", async () => {
    const s = setup();
    const { sessionId } = await idleSession(s, { id: "doc" });
    expect(s.manager.get(sessionId).persona).toMatchObject({ id: "doc" });
    await s.switcher.apply({ sessionId, persona: { id: "seg" } });
    expect(s.manager.get(sessionId).persona).toMatchObject({ id: "seg" });
    await waitFor(() => s.manager.get(sessionId).status === "idle", { label: "ociosa" });
    await s.switcher.clear({ sessionId });
    expect(s.manager.get(sessionId).persona).toMatchObject({ id: "doc" });
  });

  test("a persona do pacote vale no idioma pedido, e a do app vale inteira", async () => {
    const s = setup();
    const { sessionId } = await idleSession(s);
    const english = await s.switcher.apply({ sessionId, persona: { id: "qa", language: "en" } });
    expect(english.text).toMatch(/^From now on, act as "QA \/ testing"/);
    await waitFor(() => s.manager.get(sessionId).status === "idle", { label: "ociosa" });
    const inline = await s.switcher.apply({
      sessionId,
      persona: {
        definition: { id: "do-app", name: "Do app", description: "d", body: "Corpo do app." },
      },
    });
    expect(inline.text).toContain("Corpo do app.");
    expect(s.manager.get(sessionId).persona).toMatchObject({ id: "do-app" });
  });

  test("não aplica, e não registra nada, quando a sessão não existe ou terminou, ou a persona não vale", async () => {
    const s = setup();
    const { sessionId, events } = await idleSession(s);
    expect(
      await codeOf(() => s.switcher.apply({ sessionId: "nada", persona: { id: "seg" } })),
    ).toBe("not_found");
    expect(await codeOf(() => s.switcher.apply({ sessionId, persona: { id: "nao-existe" } }))).toBe(
      "not_found",
    );
    const secret = `ghp_${"0123456789abcdef".repeat(2)}0123`;
    expect(
      await codeOf(() =>
        s.switcher.apply({
          sessionId,
          persona: { definition: { id: "x", name: "X", description: "d", body: secret } },
        }),
      ),
    ).toBe("persona_secret");
    await s.manager.close(sessionId);
    expect(await codeOf(() => s.switcher.apply({ sessionId, persona: { id: "seg" } }))).toBe(
      "invalid_state",
    );
    expect(events.find("persona.applied")).toEqual([]);
    expect(s.manager.get(sessionId).persona).toBeUndefined();
    expect(await codeOf(() => s.switcher.apply({ persona: { id: "seg" } }))).toBe("bad_request");
    expect(
      await codeOf(() =>
        s.switcher.apply({ sessionId, claudeSessionId: "claude-1", persona: { id: "seg" } }),
      ),
    ).toBe("bad_request");
    expect(await codeOf(() => s.switcher.clear({}))).toBe("bad_request");
  });

  test("uma persona versionada sem confiança não é aplicada", async () => {
    const s = setup();
    const { sessionId } = await idleSession(s);
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const dir = join(s.project, ".flightdeck", "personas");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "do-projeto.md"),
      "---\nid: do-projeto\nname: P\ndescription: d\n---\nCorpo.\n",
    );
    expect(await codeOf(() => s.switcher.apply({ sessionId, persona: { id: "do-projeto" } }))).toBe(
      "persona_untrusted",
    );
  });
});

describe("personas-sessao-aberta: do terminal controlável", () => {
  test("aplicar vai pelo canal, põe o selo na sessão e a mensagem de saída o tira", async () => {
    const s = setup();
    const done = await s.switcher.apply({ claudeSessionId: "claude-1", persona: { id: "seg" } });
    expect(s.sentToChannel).toEqual([["L1", done.text]]);
    expect(done.text).toContain("Procure injeção e segredos expostos.");
    expect(s.external.get("claude-1")?.persona).toMatchObject({
      id: "seg",
      name: "Revisor de segurança",
    });
    expect(s.external.list().find((e) => e.claudeSessionId === "claude-1")?.persona).toMatchObject({
      id: "seg",
    });
    const left = await s.switcher.clear({ claudeSessionId: "claude-1" });
    expect(left.text).toMatch(/Saia do papel de "Revisor de segurança"/);
    expect(s.sentToChannel[1]).toEqual(["L1", left.text]);
    expect(s.external.get("claude-1")?.persona).toBeUndefined();
    expect(await codeOf(() => s.switcher.clear({ claudeSessionId: "claude-1" }))).toBe(
      "invalid_state",
    );
  });

  test("o selo avisa quem acompanha as sessões e sobrevive a um novo processo do daemon", async () => {
    const s = setup();
    const seen: Array<string | null> = [];
    s.external.onChange((session) => seen.push(session.persona?.id ?? null));
    await s.switcher.apply({ claudeSessionId: "claude-1", persona: { id: "seg" } });
    await s.switcher.clear({ claudeSessionId: "claude-1" });
    await s.switcher.apply({ claudeSessionId: "claude-1", persona: { id: "doc" } });
    expect(seen.slice(-3)).toEqual(["seg", null, "doc"]);
    const again = new ExternalSessions({ db: s.store.db, staleAfterS: 900 });
    expect(again.get("claude-1")?.persona).toMatchObject({ id: "doc" });
  });

  test("sem canal, ou uma sessão que não existe, não aplica nem registra", async () => {
    const s = setup();
    expect(
      await codeOf(() => s.switcher.apply({ claudeSessionId: "claude-2", persona: { id: "seg" } })),
    ).toBe("invalid_state");
    expect(
      await codeOf(() => s.switcher.apply({ claudeSessionId: "outra", persona: { id: "seg" } })),
    ).toBe("not_found");
    s.cutChannel();
    expect(
      await codeOf(() => s.switcher.apply({ claudeSessionId: "claude-1", persona: { id: "seg" } })),
    ).toBe("invalid_state");
    expect(s.external.get("claude-1")?.persona).toBeUndefined();
    expect(await codeOf(() => s.switcher.clear({ claudeSessionId: "outra" }))).toBe("not_found");
  });
});

describe("personas-sessao-aberta: pelo protocolo", () => {
  async function connect(s: ReturnType<typeof setup> | null, root: string) {
    const server = startServer({
      manager: s?.manager ?? newManager().manager,
      ...(s ? { personaSessions: s.switcher } : {}),
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
    const codeOfCall = async (type: string, payload: unknown) =>
      ((await client.request(type, payload)).error as { code?: string } | undefined)?.code ?? "ok";
    return { client, codeOfCall };
  }

  test("session.applyPersona e session.clearPersona, para a gerenciada e para a do terminal", async () => {
    const s = setup();
    const { sessionId } = await idleSession(s);
    const { client, codeOfCall } = await connect(s, s.root);
    expect(
      await client.data("session.applyPersona", { sessionId, persona: { id: "seg" } }),
    ).toMatchObject({
      persona: { id: "seg" },
      text: expect.stringContaining("atue como"),
    });
    await waitFor(() => s.manager.get(sessionId).status === "idle", { label: "ociosa" });
    expect(await client.data("session.clearPersona", { sessionId })).toMatchObject({
      persona: { id: "seg" },
      text: expect.stringContaining("Saia do papel"),
    });
    expect(
      await client.data("session.applyPersona", {
        claudeSessionId: "claude-1",
        persona: { id: "doc" },
      }),
    ).toMatchObject({ persona: { id: "doc" } });
    expect(
      await client.data("session.clearPersona", { claudeSessionId: "claude-1" }),
    ).toMatchObject({
      persona: { id: "doc" },
    });
    // Exactly one of the two ids.
    expect(await codeOfCall("session.applyPersona", { persona: { id: "seg" } })).toBe(
      "bad_request",
    );
    expect(
      await codeOfCall("session.applyPersona", {
        sessionId,
        claudeSessionId: "x",
        persona: { id: "seg" },
      }),
    ).toBe("bad_request");
    expect(await codeOfCall("session.clearPersona", {})).toBe("bad_request");
  });

  test("sem o serviço configurado, os comandos dizem que está desativado", async () => {
    const { root } = workspace();
    const { codeOfCall } = await connect(null, root);
    expect(
      await codeOfCall("session.applyPersona", { sessionId: "x", persona: { id: "seg" } }),
    ).toBe("invalid_state");
    expect(await codeOfCall("session.clearPersona", { sessionId: "x" })).toBe("invalid_state");
  });
});

describe("personas-sessao-aberta: o que falta no host", () => {
  test("a mensagem de saída também vem em inglês", async () => {
    const s = setup();
    const { sessionId } = await idleSession(s);
    await s.switcher.apply({ sessionId, persona: { id: "qa", language: "en" } });
    await waitFor(() => s.manager.get(sessionId).status === "idle", { label: "ociosa" });
    const left = await s.switcher.clear({ sessionId, language: "en" });
    expect(left.text).toBe('Leave the "QA / testing" role and go back to your normal behavior.');
  });

  test("sem o cadastro de personas, ou sem as sessões de terminal, o serviço diz o que falta", async () => {
    const s = setup();
    const { sessionId } = await idleSession(s);
    const bare = new OpenSessionPersonas({ manager: s.manager });
    expect(await codeOf(() => bare.apply({ sessionId, persona: { id: "seg" } }))).toBe(
      "invalid_state",
    );
    expect(
      await codeOf(() => bare.apply({ claudeSessionId: "claude-1", persona: { id: "seg" } })),
    ).toBe("invalid_state");
    expect(await codeOf(() => bare.clear({ claudeSessionId: "claude-1" }))).toBe("invalid_state");
    expect(s.manager.get(sessionId).persona).toBeUndefined();
  });
});
