import { describe, expect, test } from "bun:test";
import { AskpassRequest, SshImportEntry, SshTarget } from "@flightdeck/protocol";
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
  const sshShots = () => hostShots({} as DemoIds).filter((shot) => shot.name.startsWith("ssh-"));

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
