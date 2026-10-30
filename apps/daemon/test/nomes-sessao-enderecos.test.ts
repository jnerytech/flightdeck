import { describe, expect, test } from "bun:test";
import type { MessagingFrame } from "../src/messaging/messages.ts";
import { PROJECT, setup, twoHosts } from "./mensagens-helpers.ts";

const relays = (frames: MessagingFrame[]) =>
  frames.flatMap((f) => (f.type === "messages.relay" ? [f.message] : []));

function relayAll(from: ReturnType<typeof setup>, to: ReturnType<typeof setup>) {
  for (const message of relays(from.frames.splice(0))) {
    from.messaging.relayed(message.id, to.messaging.relay(message));
  }
}

/** A host with an asker, `s1`, and a session `s2` named `app · geral · 2` (`s1` is the first). */
function host() {
  const ctx = setup();
  ctx.endpoints.add("s1", { name: "x" });
  ctx.endpoints.add("s2", { name: "y" });
  ctx.names.assign("s1", { project: "app" });
  ctx.names.assign("s2", { project: "app" });
  return ctx;
}

const ASKER = { session: "s1" };

describe("nomes-sessao: o apelido endereça a sessão", () => {
  test("send_to_session aceita o apelido sozinho ou com o host, e a mensagem vai para o id da sessão", () => {
    const { messaging, endpoints } = host();
    expect(messaging.send({ as: ASKER, to: "app-geral-2", text: "um" }).status).toBe("delivered");
    expect(messaging.send({ as: ASKER, to: "pc/app-geral-2", text: "dois" }).status).toBe(
      "delivered",
    );
    expect(endpoints.sent.map((m) => m.id)).toEqual(["s2", "s2"]);
    expect(messaging.list({}).map((m) => m.toSession)).toEqual(["s2", "s2"]);
  });

  test("renomear mantém o apelido antigo, e o nome novo também endereça", () => {
    const { messaging, endpoints, names } = host();
    names.rename("s2", "Revisão do login");
    messaging.send({ as: ASKER, to: "app-geral-2", text: "pelo antigo" });
    messaging.send({ as: ASKER, to: "revisao-do-login", text: "pelo novo" });
    expect(endpoints.sent.map((m) => m.id)).toEqual(["s2", "s2"]);
  });

  test("o id continua valendo, e um apelido que ninguém tem é not_found", () => {
    const { messaging, endpoints } = host();
    messaging.send({ as: ASKER, to: "s2", text: "pelo id" });
    expect(endpoints.sent.map((m) => m.id)).toEqual(["s2"]);
    const missing = messaging.send({ as: ASKER, to: "app-geral-9", text: "x" });
    expect(missing).toMatchObject({ status: "refused" });
    expect(missing.reason).toContain("app-geral-9");
  });

  test("um id que é também o apelido de outra sessão vence o apelido", () => {
    const { messaging, endpoints } = host();
    endpoints.add("app-geral-2");
    messaging.send({ as: ASKER, to: "app-geral-2", text: "pelo id" });
    expect(endpoints.sent.map((m) => m.id)).toEqual(["app-geral-2"]);
  });

  test("notify_when_idle e read_session usam o mesmo endereço", () => {
    const { messaging, endpoints } = host();
    endpoints.transcripts.set("s2", {
      summary: null,
      messages: [{ role: "user", text: "oi" }],
    });
    expect(messaging.inspect(ASKER, "app-geral-2").target.id).toBe("s2");
    expect(messaging.read(ASKER, "app-geral-2").messages).toEqual([{ role: "user", text: "oi" }]);
  });
});

describe("nomes-sessao: a lista traz o nome e o apelido", () => {
  test("list_sessions mostra o nome padronizado e o apelido, e depois do renomear os dois apelidos", () => {
    const { messaging, names } = host();
    expect(messaging.sessions(ASKER)).toMatchObject([
      { id: "s2", name: "app · geral · 2", alias: "app-geral-2", aliases: ["app-geral-2"] },
    ]);
    names.rename("s2", "Revisão do login");
    expect(messaging.sessions(ASKER)).toMatchObject([
      {
        name: "Revisão do login",
        alias: "app-geral-2",
        aliases: ["app-geral-2", "revisao-do-login"],
      },
    ]);
  });

  test("uma sessão sem nome padronizado segue com o nome que o endpoint dá e sem apelido", () => {
    const { messaging, endpoints } = host();
    endpoints.add("s3", { name: "avulsa" });
    const avulsa = messaging.sessions(ASKER).find((s) => s.id === "s3");
    expect(avulsa).toMatchObject({ name: "avulsa", alias: null, aliases: [] });
  });

  test("o diretório que o app leva aos outros daemons traz os apelidos", () => {
    const { messaging } = host();
    expect(messaging.directory().find((s) => s.id === "s2")).toMatchObject({
      name: "app · geral · 2",
      alias: "app-geral-2",
      aliases: ["app-geral-2"],
    });
  });
});

describe("nomes-sessao: entre hosts o endereço é host/apelido", () => {
  test("o apelido de uma sessão do outro host leva a mensagem ao id dela, pelo app", () => {
    const { a, b } = twoHosts();
    a.endpoints.add("s1");
    b.endpoints.add("w1");
    b.names.assign("w1", { project: "app" });
    // What the app does: asks the other daemon for its directory and hands it to this one.
    a.messaging.setPeers("wsl", b.messaging.directory());
    expect(a.messaging.sessions({ session: "s1" })).toMatchObject([
      { address: "wsl/w1", alias: "app-geral-1", name: "app · geral · 1" },
    ]);
    const sent = a.messaging.send({ as: { session: "s1" }, to: "wsl/app-geral-1", text: "oi" });
    expect(sent.status).toBe("queued");
    relayAll(a, b);
    expect(b.endpoints.sent.map((m) => m.id)).toEqual(["w1"]);
    expect(a.messaging.list({})[0]).toMatchObject({ toSession: "w1", toHost: "wsl" });
  });

  test("um app antigo que não manda apelidos segue endereçando pelo id", () => {
    const { a, b } = twoHosts();
    a.endpoints.add("s1");
    b.endpoints.add("w1");
    a.messaging.setPeers("wsl", [
      {
        id: "w1",
        name: null,
        persona: null,
        projectKey: PROJECT,
        teamId: null,
        state: "idle",
        kind: "managed",
        receives: true,
        reason: null,
      },
    ]);
    expect(a.messaging.send({ as: { session: "s1" }, to: "wsl/w1", text: "oi" }).status).toBe(
      "queued",
    );
    const missing = a.messaging.send({ as: { session: "s1" }, to: "wsl/nada", text: "x" });
    expect(missing.status).toBe("refused");
    expect(missing.reason).toContain("wsl/nada");
    expect(a.messaging.sessions({ session: "s1" })).toMatchObject([{ alias: null, aliases: [] }]);
  });
});
