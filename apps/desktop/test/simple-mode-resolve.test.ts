import { describe, expect, test } from "bun:test";
import { effectiveMode, loadChoices, saveChoice, UI_CHOICES_KEY } from "../src/lib/simple-mode.ts";

const memory = (initial?: string) => {
  const data = new Map<string, string>(initial ? [[UI_CHOICES_KEY, initial]] : []);
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
};

describe("simple-mode-resolve: which mode a host opens in", () => {
  test("Given no choice and no host default, When resolved, Then it is full and the switch is offered", () => {
    expect(effectiveMode(null, undefined)).toEqual({ mode: "full", canSwitch: true });
    expect(effectiveMode(undefined, { mode: "full", locked: false })).toEqual({
      mode: "full",
      canSwitch: true,
    });
  });

  test("Given a host set to simple and no choice, When resolved, Then it is simple, and the person's own choice wins over it", () => {
    expect(effectiveMode(null, { mode: "simple", locked: false })).toEqual({
      mode: "simple",
      canSwitch: true,
    });
    expect(effectiveMode("full", { mode: "simple", locked: false }).mode).toBe("full");
    expect(effectiveMode("simple", { mode: "full", locked: false }).mode).toBe("simple");
  });

  test("Given a locked host, When resolved, Then the host's mode stands whatever the person chose, and there is no switch", () => {
    expect(effectiveMode("full", { mode: "simple", locked: true })).toEqual({
      mode: "simple",
      canSwitch: false,
    });
    expect(effectiveMode("simple", { mode: "full", locked: true })).toEqual({
      mode: "full",
      canSwitch: false,
    });
  });

  test("Given values the app does not know, When resolved, Then they are full and unlocked", () => {
    expect(effectiveMode("wild", { mode: "wild", locked: "yes" })).toEqual({
      mode: "full",
      canSwitch: true,
    });
    expect(effectiveMode(42, { mode: 7 })).toEqual({ mode: "full", canSwitch: true });
  });
});

describe("simple-mode-resolve: the person's choice is kept per host", () => {
  test("Given choices for two hosts, When read back, Then each host has its own", () => {
    const storage = memory();
    saveChoice(storage, "a", "simple");
    saveChoice(storage, "b", "full");
    expect(loadChoices(storage)).toEqual({ a: "simple", b: "full" });
  });

  test("Given a choice forgotten, Then the host's default speaks again", () => {
    const storage = memory();
    saveChoice(storage, "a", "simple");
    saveChoice(storage, "a", null);
    expect(loadChoices(storage)).toEqual({});
  });

  test("Given unreadable storage or odd values, Then there are no choices", () => {
    expect(loadChoices(memory("{lixo"))).toEqual({});
    expect(loadChoices(memory('["a"]'))).toEqual({});
    expect(loadChoices(memory('{"a":"wild","b":"simple"}'))).toEqual({ b: "simple" });
  });
});
