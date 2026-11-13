import { describe, expect, test } from "bun:test";
import { en } from "../../src/i18n/en.ts";
import { ptBR } from "../../src/i18n/pt-BR.ts";

/**
 * WCAG 2.5.3 (Label in Name, #2649): a button's accessible name starts with its visible text, so a
 * person who says the visible text to voice control reaches it. Each pair is the visible text and
 * the name that adds the team or the member.
 */
const PAIRS = [
  ["openSession", "openSessionOf"],
  ["openCard", "openCardOf"],
  ["addWorkerButton", "addWorker"],
  ["addWorkerButton", "addRow"],
  ["setPersonaButton", "setPersona"],
  ["removeButton", "remove"],
  ["removeButton", "removeRow"],
  ["pauseButton", "pause"],
  ["resumeButton", "resume"],
  ["closeButton", "close"],
  ["addMemberButton", "addMember"],
] as const;

describe.each([
  ["en", en],
  ["pt-BR", ptBR],
] as const)("the team buttons in %s", (_language, dictionary) => {
  test.each(PAIRS)("%s is the start of %s", (visible, named) => {
    const shown = dictionary.teamsUi[visible].toLowerCase();
    const name = dictionary.teamsUi[named].toLowerCase();
    expect(name.startsWith(shown), `"${name}" starts with "${shown}"`).toBe(true);
  });
});
