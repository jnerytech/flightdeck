import { describe, expect, test } from "bun:test";
import {
  AskpassRequest,
  SshHostKeyCheck,
  SshImportEntry,
  SshTarget,
  SshTestResult,
} from "@flightdeck/protocol";
import type { DemoIds } from "../../demo-seed.ts";
import { installHolds } from "../../lib/shots/holds.ts";
import { sshRewriter, sshScript } from "../../lib/shots/ssh-frames.ts";
import { hostShots } from "../../lib/shots/table-hosts.ts";

/**
 * #3943: the SSH Connections prints. The demo's hosts are real daemons: their `ssh.list` is empty,
 * their import reads the machine's own `~/.ssh/config`, and no ssh ever asks for a password. The print
 * wraps the page's sockets, so the screen shows the same fake destinos, config names and prompt
 * everywhere, and no real ssh material is read.
 */
const ask = (id: string, type: string) => JSON.stringify({ id, type, payload: {} });
const ack = (id: string, data: object) => JSON.stringify({ type: "ack", id, ok: true, data });

/** What the app hears after it asked `type`: the rewritten answer and the frames that follow it. */
function heard(type: string, data: object = {}, rewriter = sshRewriter(true)) {
  rewriter.fromApp(ask("r1", type));
  const answer = ack("r1", data);
  return {
    out: JSON.parse(rewriter.fromHost(answer)) as { data: Record<string, unknown> },
    after: (rewriter.followUp?.(answer) ?? []).map((frame) => JSON.parse(frame)),
  };
}

const targets = (data: Record<string, unknown>) =>
  (data.targets as unknown[]).map((row) => SshTarget.parse(row));

describe("shots-ssh: the answers the print shows", () => {
  test("ssh.list answers with fake destinos that are valid, with a tag, a port and no secret", () => {
    const list = targets(heard("ssh.list", { targets: [] }).out.data);
    expect(list.length).toBeGreaterThanOrEqual(3);
    expect(list.some((t) => t.port !== 22)).toBe(true);
    expect(list.some((t) => t.tags.length > 0)).toBe(true);
    expect(list.every((t) => t.secretRef === null)).toBe(true);
  });

  test("the destinos use only documentation addresses and example.test names", () => {
    const hosts = targets(heard("ssh.list", { targets: [] }).out.data).map((t) => t.host);
    expect(hosts.filter((h) => !/^203\.0\.113\.\d+$|\.example\.test$/.test(h))).toEqual([]);
  });

  test("ssh.import.preview answers with config names, one of them already registered", () => {
    const entries = (
      heard("ssh.import.preview", { entries: [] }).out.data.entries as unknown[]
    ).map((row) => SshImportEntry.parse(row));
    expect(entries.some((e) => e.exists)).toBe(true);
    expect(entries.some((e) => !e.exists)).toBe(true);
    expect(entries.filter((e) => !/^203\.0\.113\.\d+$|\.example\.test$/.test(e.host))).toEqual([]);
  });

  test("other answers, events and frames that are not JSON pass as they came", () => {
    const rewriter = sshRewriter();
    rewriter.fromApp(ask("r1", "project.list"));
    rewriter.fromApp("not json");
    const other = ack("r1", { projects: [] });
    const event = JSON.stringify({ type: "board.updated", id: "r2" });
    expect([rewriter.fromHost(other), rewriter.fromHost(event), rewriter.fromHost("{")]).toEqual([
      other,
      event,
      "{",
    ]);
  });

  test("a refused ssh.list passes as it came", () => {
    const rewriter = sshRewriter();
    rewriter.fromApp(ask("r1", "ssh.list"));
    const refusal = JSON.stringify({ type: "ack", id: "r1", ok: false, error: { code: "x" } });
    expect(rewriter.fromHost(refusal)).toBe(refusal);
  });
});

describe("shots-ssh: the askpass prompt", () => {
  test("one askpass.request follows the first ssh.list answer, a valid one with a fake prompt", () => {
    const { after } = heard("ssh.list", { targets: [] });
    expect(after).toHaveLength(1);
    const request = AskpassRequest.parse(after[0]);
    expect([
      request.kind,
      request.secretRef,
      /^[^@\s]+@(203\.0\.113\.\d+|[a-z.-]+\.example\.test)'s password:$/.test(request.prompt),
    ]).toEqual(["password", null, true]);
  });

  test("the prompt names a destino of the list", () => {
    const rewriter = sshRewriter(true);
    const { out, after } = heard("ssh.list", { targets: [] }, rewriter);
    const names = targets(out.data).map((t) => t.name);
    expect(names).toContain(AskpassRequest.parse(after[0]).targetName);
  });

  test("the prompt asks for the host of the destino it names", () => {
    const { out, after } = heard("ssh.list", { targets: [] });
    const asked = AskpassRequest.parse(after[0]);
    const named = targets(out.data).find((t) => t.name === asked.targetName);
    expect(asked.prompt).toBe(`${named?.user}@${named?.host}'s password:`);
  });

  test("a second ssh.list answer brings no second prompt: the person has one to answer", () => {
    const rewriter = sshRewriter(true);
    heard("ssh.list", { targets: [] }, rewriter);
    rewriter.fromApp(ask("r2", "ssh.list"));
    const again = ack("r2", { targets: [] });
    rewriter.fromHost(again);
    expect(rewriter.followUp?.(again)).toEqual([]);
  });

  test("with the prompt off, the first ssh.list answer brings no frame after it", () => {
    expect(heard("ssh.list", { targets: [] }, sshRewriter(false)).after).toEqual([]);
  });

  test("a frame that is no ssh.list answer brings no prompt", () => {
    const rewriter = sshRewriter();
    rewriter.fromApp(ask("r1", "project.list"));
    const other = ack("r1", {});
    rewriter.fromHost(other);
    expect(rewriter.followUp?.(other) ?? []).toEqual([]);
  });
});

/** A socket that records what the app sends and lets the test play the host's frames. */
class FakeSocket {
  listeners: Array<(event: { data: unknown }) => void> = [];
  send() {}
  addEventListener(type: string, listener: (event: { data: unknown }) => void) {
    if (type === "message") this.listeners.push(listener);
  }
  play(data: unknown) {
    for (const listener of this.listeners) listener({ data });
  }
}

describe("shots-ssh: the page's WebSocket", () => {
  test("the app hears the rewritten answer, then the frame that follows it", () => {
    const target = { WebSocket: FakeSocket as unknown as typeof WebSocket };
    installHolds(target, () => sshRewriter(true));
    const socket = new target.WebSocket("ws://x") as unknown as FakeSocket;
    const got: unknown[] = [];
    socket.addEventListener("message", (event) => got.push(event.data));
    (socket as unknown as { send(data: string): void }).send(ask("r1", "ssh.list"));
    socket.play(ack("r1", { targets: [] }));
    const types = got.map((frame) => JSON.parse(String(frame)).type);
    expect(types).toEqual(["ack", "askpass.request"]);
  });

  test("the init script alone wraps the window's WebSocket for the ssh prints", () => {
    const page = { WebSocket: FakeSocket as unknown as typeof WebSocket };
    new Function("window", sshScript(true))(page);
    const socket = new page.WebSocket("ws://x") as unknown as FakeSocket;
    const got: unknown[] = [];
    socket.addEventListener("message", (event) => got.push(event.data));
    (socket as unknown as { send(data: string): void }).send(ask("r1", "ssh.list"));
    socket.play(ack("r1", { targets: [] }));
    expect(JSON.parse(String(got[0])).data.targets.length).toBeGreaterThanOrEqual(3);
  });

  test("the init script calls no transpile helper", () => {
    expect(sshScript(true).match(/\b__\w+/g) ?? []).toEqual([]);
  });
});

describe("shots-ssh: the table", () => {
  const FIRST = ["ssh-destinos", "ssh-novo", "ssh-importar", "ssh-askpass"];
  const sshShots = () => hostShots({} as DemoIds).filter((shot) => FIRST.includes(shot.name));

  test("the table prints the list, the new-destino form, the import and the askpass prompt", () => {
    expect(sshShots().map((shot) => shot.name)).toEqual([
      "ssh-destinos",
      "ssh-novo",
      "ssh-importar",
      "ssh-askpass",
    ]);
  });

  test("each ssh print opens Connections with the socket rewriter on, the prompt only in the last", () => {
    expect(sshShots().map((shot) => [shot.route.name, shot.ssh, shot.askpass === true])).toEqual([
      ["connections", true, false],
      ["connections", true, false],
      ["connections", true, false],
      ["connections", true, true],
    ]);
  });
});

/** The prints of #4335: the form's variants, the test result, the server key dialogs and the two confirms. */
const STATES = [
  "ssh-editar",
  "ssh-editar-arquivo",
  "ssh-editar-cofre",
  "ssh-teste-ok",
  "ssh-teste-falhou",
  "ssh-chave-nova",
  "ssh-chave-mudou",
  "ssh-remover",
  "ssh-agente",
];

describe("shots-ssh: the states of #4335", () => {
  const state = (name: string) => hostShots({} as DemoIds).find((shot) => shot.name === name);
  /** What the print answers in the page for one command, in the host's place. */
  const replyOf = (name: string, command: string): unknown => state(name)?.sshReplies?.[command];

  test("the table prints each state after the first four, in this order", () => {
    const names = hostShots({} as DemoIds)
      .map((shot) => shot.name)
      .filter((name) => name.startsWith("ssh-"));
    expect(names.slice(4, 4 + STATES.length)).toEqual(STATES);
  });

  test("each state opens Connections with the socket rewriter on and no askpass prompt", () => {
    expect(
      STATES.map((name) => [state(name)?.route.name, state(name)?.ssh, state(name)?.askpass]),
    ).toEqual(STATES.map(() => ["connections", true, undefined]));
  });

  test("the first-connection dialog is answered with an unknown key and nothing pinned", () => {
    const check = SshHostKeyCheck.safeParse(replyOf("ssh-chave-nova", "ssh.hostkey.check")).data;
    expect([check?.status, check?.pinned, check?.fingerprint.startsWith("SHA256:")]).toEqual([
      "unknown",
      null,
      true,
    ]);
  });

  test("the changed-key dialog shows the key the destino kept, and a different one now", () => {
    const check = SshHostKeyCheck.safeParse(replyOf("ssh-chave-mudou", "ssh.hostkey.check")).data;
    const kept = targets(heard("ssh.list", { targets: [] }).out.data).find(
      (t) => t.name === "build-server",
    )?.hostKey;
    expect([check?.status, check?.pinned === kept, check?.fingerprint === check?.pinned]).toEqual([
      "changed",
      true,
      false,
    ]);
  });

  test("the test result is answered ok in one print and refused, with its reason, in the other", () => {
    const ok = SshTestResult.safeParse(replyOf("ssh-teste-ok", "ssh.test")).data;
    const failed = SshTestResult.safeParse(replyOf("ssh-teste-falhou", "ssh.test")).data;
    expect([ok?.ok, failed?.ok, failed?.reason]).toEqual([true, false, "ssh_test_auth"]);
  });

  test("only the key dialogs and the test result are answered in the page", () => {
    expect(STATES.filter((name) => state(name)?.sshReplies !== undefined)).toEqual([
      "ssh-teste-ok",
      "ssh-teste-falhou",
      "ssh-chave-nova",
      "ssh-chave-mudou",
    ]);
  });
});

/** The list states of #4335: a filter with no match, nothing to import, no host with ssh, a failed list and a list still loading. */
const LIST_STATES = [
  "ssh-sem-resultado",
  "ssh-importar-vazio",
  "ssh-sem-host",
  "ssh-lista-falhou",
  "ssh-lista-carregando",
];

describe("shots-ssh: the list states of #4335", () => {
  const state = (name: string) => hostShots({} as DemoIds).find((shot) => shot.name === name);

  test("the table prints them after the form states, in this order", () => {
    const names = hostShots({} as DemoIds)
      .map((shot) => shot.name)
      .filter((name) => name.startsWith("ssh-"));
    expect(names.slice(4 + STATES.length)).toEqual(LIST_STATES);
  });

  test("a filter with no match and an import with nothing are answered with the fake destinos", () => {
    expect([state("ssh-sem-resultado")?.ssh, state("ssh-importar-vazio")?.ssh]).toEqual([
      true,
      true,
    ]);
    expect(state("ssh-importar-vazio")?.sshReplies).toEqual({
      "ssh.import.preview": { entries: [] },
    });
  });

  test("no host with ssh: every host stops announcing the feature, and the rewriter that fakes destinos is off", () => {
    const shot = state("ssh-sem-host");
    expect([shot?.wire, shot?.ssh]).toEqual([
      [{ command: "host.info", without: { features: ["ssh"] } }],
      undefined,
    ]);
  });

  test("a failed list is a refused ssh.list, and a loading one an ssh.list the page never hears", () => {
    const failed = state("ssh-lista-falhou");
    const loading = state("ssh-lista-carregando");
    expect([
      failed?.wire?.map((rule) => ("refuse" in rule ? rule.command : null)),
      loading?.wire?.map((rule) => ("hold" in rule ? rule.command : null)),
      failed?.ssh,
      loading?.ssh,
    ]).toEqual([["ssh.list"], ["ssh.list"], undefined, undefined]);
  });
});

describe("shots-ssh: the answers a print makes in the host's place", () => {
  const replies = { "ssh.test": { ok: true, error: null } };

  test("the command a print replies to is answered in the page", () => {
    const answer = sshRewriter(false, replies).answer?.(ask("r9", "ssh.test"));
    expect(JSON.parse(answer ?? "null")).toEqual({
      type: "ack",
      id: "r9",
      ok: true,
      data: { ok: true, error: null },
    });
  });

  test("any other command, and a frame that is no JSON, goes to the host", () => {
    const rewriter = sshRewriter(false, replies);
    expect([rewriter.answer?.(ask("r9", "ssh.list")), rewriter.answer?.("not json")]).toEqual([
      undefined,
      undefined,
    ]);
  });

  test("the init script carries the replies into the page", async () => {
    const page = { WebSocket: FakeSocket as unknown as typeof WebSocket };
    new Function("window", sshScript(false, replies))(page);
    const socket = new page.WebSocket("ws://x") as unknown as FakeSocket;
    const got: Array<{ data: unknown }> = [];
    socket.addEventListener("message", (event) => got.push(JSON.parse(String(event.data))));
    (socket as unknown as { send(data: string): void }).send(ask("r9", "ssh.test"));
    // The answer is queued as a microtask: one await lets it through.
    await Promise.resolve();
    expect(got.map((frame) => frame.data)).toEqual([{ ok: true, error: null }]);
  });
});
