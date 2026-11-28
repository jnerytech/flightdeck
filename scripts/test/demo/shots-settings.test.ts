import { describe, expect, test } from "bun:test";
import type { DemoIds } from "../../demo-seed.ts";
import { NARROW_SHOTS } from "../../lib/shots/narrow.ts";
import { settingsShots } from "../../lib/shots/table-settings.ts";

const NAMES = [
  "configuracoes-janela",
  "configuracoes-notificacoes",
  "configuracoes-atalho",
  "configuracoes-vigiar",
  "configuracoes-atualizacoes-ok",
  "configuracoes-atualizacoes-falhou",
  "configuracoes-diagnostico",
];
const shots = () => settingsShots({} as DemoIds);
const named = (name: string) => shots().find((shot) => shot.name === name);

// #4435, #4436: the Settings sections that had no print of their own, so no axe check and no review.
describe("the Settings section prints (#4435, #4436)", () => {
  test("the table prints Window, Notifications, Global shortcut, Watch and fix PRs, Updates (up to date, failed) and Diagnostics", () => {
    expect(shots().map((shot) => shot.name)).toEqual(NAMES);
  });

  test("each print opens Settings and brings its section to the top of the page", () => {
    for (const name of NAMES) {
      expect(named(name)?.route).toEqual({ name: "settings" });
      expect(named(name)?.prepare).toBeFunction();
    }
  });

  test("each print is measured at 1024, 640 and 390 px, where the sections' rows and notices must wrap", () => {
    for (const name of NAMES) expect(NARROW_SHOTS).toContain(name);
  });

  test("the demo's platform is told what each state needs: an updater that answers or fails, a shortcut the system refuses, a log file", () => {
    expect(named("configuracoes-atualizacoes-ok")?.query).toEqual({ update: "none" });
    expect(named("configuracoes-atualizacoes-falhou")?.query).toEqual({ update: "fail" });
    expect(named("configuracoes-atalho")?.query).toEqual({ shortcut: "taken" });
    expect(named("configuracoes-diagnostico")?.query).toEqual({ logs: "demo" });
  });

  test("the Watch print answers host.info as a far connection, whose fields are read-only", () => {
    const rule = named("configuracoes-vigiar")?.wire?.find((r) => r.command === "host.info");
    expect(rule && "set" in rule ? rule.set : null).toEqual({ near: false });
  });
});
