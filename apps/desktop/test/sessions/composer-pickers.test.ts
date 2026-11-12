import { describe, expect, test } from "bun:test";
import { slashFill } from "../../src/features/sessions/command-menu.ts";
import {
  composerModeMenu,
  offersModelPicker,
} from "../../src/features/sessions/composer-pickers.ts";

/** #1605 (Humble Object): what SessionView decides about the composer's pickers and the `/` menu. */
describe("the model picker", () => {
  const base = { settings: true, canSetModel: true, opencode: false, hasModels: false };

  test("is offered when the session lets the model change, with or without a model list", () => {
    expect(offersModelPicker(base)).toBe(true);
    expect(offersModelPicker({ ...base, hasModels: true })).toBe(true);
  });

  test("is not offered when settings are off or the session cannot set a model", () => {
    expect(offersModelPicker({ ...base, settings: false })).toBe(false);
    expect(offersModelPicker({ ...base, canSetModel: false })).toBe(false);
  });

  test("on OpenCode it waits for the host's model list", () => {
    expect(offersModelPicker({ ...base, opencode: true })).toBe(false);
    expect(offersModelPicker({ ...base, opencode: true, hasModels: true })).toBe(true);
  });
});

describe("the mode menu", () => {
  const base = {
    current: "default",
    start: "plan",
    bypassAllowed: false,
    opencode: false,
  } as const;
  const modes = (rows: { mode: string }[]) => rows.map((row) => row.mode);
  const blocked = (rows: { mode: string; blocked: string | null }[]) =>
    Object.fromEntries(rows.map((row) => [row.mode, row.blocked]));

  test("marks the current mode, and blocks what is looser than the start", () => {
    const rows = composerModeMenu(base);
    expect(rows.find((row) => row.current)?.mode).toBe("default");
    expect(blocked(rows)).toMatchObject({
      plan: null,
      default: "looserThanStart",
      acceptEdits: "looserThanStart",
      bypassPermissions: "bypassOff",
    });
  });

  test("an unknown start blocks nothing as looser, since the loosest mode is the base", () => {
    const rows = composerModeMenu({ ...base, start: null });
    expect(rows.some((row) => row.blocked === "looserThanStart")).toBe(false);
    expect(blocked(rows).bypassPermissions).toBe("bypassOff");
  });

  test("where bypass is allowed, no row is blocked", () => {
    const rows = composerModeMenu({ ...base, bypassAllowed: true });
    expect(rows.every((row) => row.blocked === null)).toBe(true);
  });

  test("OpenCode has no accept-edits mode, and the others stay in order", () => {
    const rows = composerModeMenu({ ...base, opencode: true, bypassAllowed: true });
    expect(modes(rows)).not.toContain("acceptEdits");
    expect(modes(rows)).toEqual(
      modes(composerModeMenu({ ...base, bypassAllowed: true })).filter((m) => m !== "acceptEdits"),
    );
  });
});

describe("the / menu fill", () => {
  test("a command key fills the command and a space", () => {
    expect(slashFill("slash:compact")).toBe("/compact ");
    expect(slashFill("slash:review-pr")).toBe("/review-pr ");
  });

  test("a snippet key is the host's to fill", () => {
    expect(slashFill("snippet:1")).toBeNull();
    expect(slashFill("")).toBeNull();
    expect(slashFill("slashy")).toBeNull();
  });
});
