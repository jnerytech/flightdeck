import { describe, expect, test } from "bun:test";
import type { DemoIds } from "../../demo-seed.ts";
import { ALFA } from "../../lib/shots/shot.ts";
import { backgroundShots } from "../../lib/shots/table-background.ts";
import type { WireRule } from "../../lib/shots/wire.ts";

const IDS = {} as DemoIds;
const STATES = ["working", "blocked", "done", "failed", "stopped"];
const PANEL = ["trabalhando", "bloqueada", "concluida", "falhou", "parada"].map(
  (name) => `sessao-bg-${name}`,
);
const ACTIONS = [
  "sessao-bg-mensagem",
  "sessao-bg-mensagem-enviada",
  "sessao-bg-mensagem-recusada",
  "sessao-bg-parar-recusado",
];
const OTHERS = ["hub-bg", "nova-sessao-bg", "card-menu-bg"];
const named = (name: string) => backgroundShots(IDS).find((shot) => shot.name === name);

interface Bg {
  state: string;
  waitingFor: string | null;
  claudeSessionId: string | null;
}
const rule = (name: string, command: string): WireRule | undefined =>
  named(name)?.wire?.find((r) => r.command === command);
const listOf = (name: string): Bg[] => {
  const found = rule(name, "bg.list");
  return found && "reply" in found ? (found.reply as { sessions: Bg[] }).sessions : [];
};

// #4173: the panel, the hub's rows, the Message field and the Start option had no print, so axe
// and the visual check never read any of them.
describe("the background session prints (#4173)", () => {
  test("the table prints the five states, the message and refused-action states, the hub, the new-session option and the card menu", () => {
    expect(backgroundShots(IDS).map((shot) => shot.name)).toEqual([
      ...PANEL,
      ...ACTIONS,
      ...OTHERS,
    ]);
  });

  test("each state print opens a session the host lists in that state, and only blocked says what it waits for", () => {
    PANEL.forEach((name, at) => {
      const [listed] = listOf(name);
      const route = named(name)?.route;
      expect(listOf(name).length).toBe(1);
      expect(listed?.state).toBe(STATES[at] ?? "");
      expect(route?.name === "external" ? route.host : null).toBe(ALFA);
      expect(route?.name === "external" ? route.claudeSessionId : null).toBe(
        listed?.claudeSessionId ?? "none",
      );
      expect(listed?.waitingFor === null).toBe(STATES[at] !== "blocked");
    });
  });

  test("the hub print lists a session in each of the five states that no screen of the demo owns", () => {
    expect(named("hub-bg")?.route).toEqual({ name: "hub" });
    expect(listOf("hub-bg").map((s) => s.state)).toEqual(STATES);
    expect(listOf("hub-bg").every((s) => s.claudeSessionId === null)).toBe(true);
  });

  test("only the print of a sent message has the host accept a message; the refused ones leave it to the host, which does not list the session", () => {
    expect(rule("sessao-bg-mensagem-enviada", "bg.message")).toBeDefined();
    expect(rule("sessao-bg-mensagem-recusada", "bg.message")).toBeUndefined();
    expect(rule("sessao-bg-parar-recusado", "bg.stop")).toBeUndefined();
    expect(rule("sessao-bg-mensagem", "bg.message")).toBeUndefined();
    for (const name of ACTIONS) expect(listOf(name).length).toBe(1);
  });

  test("the new-session print is the form of the demo's first host, and the card menu print starts on the board", () => {
    expect(named("nova-sessao-bg")?.route).toEqual({ name: "new-session", host: ALFA });
    expect(named("card-menu-bg")?.route.name).toBe("board");
    expect(named("card-menu-bg")?.prepare).toBeDefined();
  });
});
