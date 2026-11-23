import { describe, expect, test } from "bun:test";
import { safeFixCommand, safeFixUrl } from "@flightdeck/protocol";
import type { DemoIds } from "../../demo-seed.ts";
import { narrowSizes } from "../../lib/shots/narrow.ts";
import { healthShots } from "../../lib/shots/table-health.ts";
import type { WireRule } from "../../lib/shots/wire.ts";

const IDS = {} as DemoIds;
const NAMES = [
  "host-saude-falta",
  "host-saude-lendo",
  "host-saude-leitura-falhou",
  "host-saude-correcoes",
  "host-saude-hooks-dialogo",
  "host-saude-servico-dialogo",
  "host-saude-boot",
  "host-saude-ok-aberto",
];
const named = (name: string) => healthShots(IDS).find((shot) => shot.name === name);
const rule = (name: string, command: string): WireRule | undefined =>
  named(name)?.wire?.find((r) => r.command === command);
/** The dependencies a print's `deps.check` answer gives, by id with their state. */
function states(name: string): Record<string, string> {
  const found = rule(name, "deps.check");
  const data = found && "data" in found ? (found.data as { items: DepItem[] }) : { items: [] };
  return Object.fromEntries(data.items.map((item) => [item.id, item.state]));
}
interface DepItem {
  id: string;
  state: string;
  path?: string;
  fix: Array<{ os: string; command?: string; url?: string }>;
}
const items = (name: string): DepItem[] => {
  const found = rule(name, "deps.check");
  return found && "data" in found ? (found.data as { items: DepItem[] }).items : [];
};

// #4325: the Health & dependencies panel had one print, the demo's good state: a missing tool, a failed
// read, the fixes, the boot note and the folded list had none, so no axe check and no look at 390 px.
describe("the Health & dependencies prints (#4325)", () => {
  test("the table prints each state of the panel, in this order", () => {
    expect(healthShots(IDS).map((shot) => shot.name)).toEqual(NAMES);
  });

  test("every print opens the page of the demo's first host", () => {
    expect(
      healthShots(IDS).map((shot) => (shot.route.name === "host" ? shot.route.host : null)),
    ).toEqual(NAMES.map(() => "demo-alfa"));
  });

  test("the missing-tool print has a required tool missing and one outdated, each with a command and an install page for every system", () => {
    expect(states("host-saude-falta")).toMatchObject({ git: "missing", claude: "outdated" });
    const lacking = items("host-saude-falta").filter((item) => item.state !== "ok");
    expect(lacking.map((item) => item.fix.filter((fix) => fix.command && fix.url).length)).toEqual(
      lacking.map(() => 3),
    );
  });

  test("the first-read print never answers either read, so the panel stays on Checking", () => {
    expect(named("host-saude-lendo")?.wire).toEqual([
      { command: "deps.check", hold: true },
      { command: "doctor.run", hold: true },
    ]);
  });

  test("the failed-read print lets the first read of each kind through and refuses the ones after it", () => {
    expect(
      ["deps.check", "doctor.run"].map((command) => {
        const found = rule("host-saude-leitura-falhou", command);
        return found && "as" in found
          ? [found.as, found.afterRefuse?.length ? "refuses" : "answers"]
          : null;
      }),
    ).toEqual([
      ["deps.check", "refuses"],
      ["doctor.run", "refuses"],
    ]);
  });

  test("the fixes print lacks the three things the panel fixes in one click, and the service's command is the one the row looks for", () => {
    expect(states("host-saude-correcoes")).toMatchObject({
      hooks: "missing",
      folders: "missing",
      service: "missing",
    });
    expect(
      items("host-saude-correcoes")
        .find((item) => item.id === "service")
        ?.fix.some((fix) => fix.command === "flightdeckd service install"),
    ).toBe(true);
  });

  test("the dialogs and the boot note start from the fixes' answers, and the boot note's service answer asks for the linger line", () => {
    for (const name of [
      "host-saude-hooks-dialogo",
      "host-saude-servico-dialogo",
      "host-saude-boot",
    ])
      expect(states(name)).toEqual(states("host-saude-correcoes"));
    expect(rule("host-saude-boot", "service.install")).toEqual({
      command: "service.install",
      reply: { startsAt: "boot", lingerOff: true, user: expect.any(String) },
    });
    expect(rule("host-saude-hooks-dialogo", "service.install")).toBeUndefined();
  });

  test("every command and page a print offers as a fix is one the app accepts, or the row shows no button for it", () => {
    const fixes = NAMES.flatMap((name) => items(name).flatMap((item) => item.fix));
    expect(fixes.length).toBeGreaterThan(0);
    expect(fixes.filter((fix) => fix.command && !safeFixCommand(fix.command))).toEqual([]);
    expect(fixes.filter((fix) => fix.url && !safeFixUrl(fix.url))).toEqual([]);
  });

  test("the boot print's re-read after the service is turned on has the service working and nothing else changed", () => {
    const found = rule("host-saude-boot", "deps.check");
    const later = found && "after" in found ? (found.after as { items: DepItem[] }) : { items: [] };
    const now = Object.fromEntries(later.items.map((item) => [item.id, item.state]));
    expect(now).toEqual({ ...states("host-saude-correcoes"), service: "ok" });
  });

  test("the folded-list print has nothing to fix and one path too long for a narrow row", () => {
    const list = items("host-saude-ok-aberto");
    expect(list.every((item) => item.state === "ok" || item.state === "na")).toBe(true);
    expect(list.some((item) => (item.path ?? "").length > 90)).toBe(true);
  });

  test("the page, the missing tool, the fixes and the folded list are re-measured narrow", () => {
    expect(
      ["host-saude", "host-saude-falta", "host-saude-correcoes", "host-saude-ok-aberto"].map(
        (name) => narrowSizes("dark", name).length,
      ),
    ).toEqual([3, 3, 3, 3]);
  });
});

/** The calls a print's `prepare` makes on a page that records them, in order. */
async function calls(name: string): Promise<string[]> {
  const made: string[] = [];
  const text = (arg: unknown): string => {
    if (arg instanceof RegExp || typeof arg === "string") return String(arg);
    if (typeof arg === "object" && arg !== null) return Object.values(arg).map(text).join(",");
    return typeof arg;
  };
  const member = (call: string): unknown =>
    new Proxy(
      (...args: unknown[]) => {
        made.push(`${call}(${args.map(text).join(",")})`);
        return recorder;
      },
      { get: (_target, prop) => (recorder as Record<string | symbol, unknown>)[prop] },
    );
  // `then` stays undefined, or awaiting the recorder would wait for it forever.
  const recorder: unknown = new Proxy(() => recorder, {
    get: (_target, prop) => (prop === "then" ? undefined : member(String(prop))),
  });
  await named(name)?.prepare?.(recorder as never);
  return made;
}

/** True when every needle shows in the calls and the first show of each comes after the one before. */
function inOrder(made: string[], ...needles: string[]): boolean {
  const at = needles.map((needle) => made.findIndex((call) => call.includes(needle)));
  return at.every((index, n) => index > -1 && index > (at[n - 1] ?? -1));
}

describe("what each Health & dependencies print does before the shot", () => {
  test("a print of a good read waits for the count line before it scrolls to the panel", async () => {
    expect([
      inOrder(await calls("host-saude-falta"), "OK: ", "evaluate("),
      inOrder(await calls("host-saude-correcoes"), "OK: ", "evaluate("),
    ]).toEqual([true, true]);
  });

  test("the first-read print waits for Checking, since no row shows", async () => {
    expect(inOrder(await calls("host-saude-lendo"), "Checking", "evaluate(")).toBe(true);
  });

  test("the failed-read print asks again after a good read and waits for the reason", async () => {
    expect(
      inOrder(await calls("host-saude-leitura-falhou"), "OK: ", "Check again", "Could not read"),
    ).toBe(true);
  });

  test("the dialogs open from their row, and the boot note waits for the service to be confirmed and re-read", async () => {
    expect([
      inOrder(await calls("host-saude-hooks-dialogo"), "Install hooks", "alertdialog"),
      inOrder(await calls("host-saude-servico-dialogo"), "Turn on start at boot", "alertdialog"),
      inOrder(
        await calls("host-saude-boot"),
        "Turn on start at boot",
        "alertdialog",
        "Turn it on",
        "Iniciar no boot",
        "detached",
      ),
    ]).toEqual([true, true, true]);
  });

  test("the folded list is opened before the print waits for it", async () => {
    expect(inOrder(await calls("host-saude-ok-aberto"), "Mostrar", "Funcionando")).toBe(true);
  });
});
