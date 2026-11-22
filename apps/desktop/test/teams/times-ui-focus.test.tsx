import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { settleMaybe } from "../wait.ts";
import {
  click,
  create,
  open,
  row,
  screen,
  settle,
  teardown,
  workerRows,
} from "./times-ui-setup.tsx";

setDefaultTimeout(60_000);
afterEach(teardown);

/** Focuses the button, then presses it, as a person at the keyboard does. */
async function press(name: string | RegExp) {
  const button = screen.queryByRole("button", { name }) as HTMLButtonElement | null;
  expect(button).not.toBeNull();
  button?.focus();
  await click(name);
}

const focused = () => document.activeElement;

/** What has the focus, as text: a failed check never prints a DOM node. */
const where = () => {
  const el = focused();
  return el
    ? `${el.tagName} ${el.getAttribute("aria-label") ?? el.textContent?.slice(0, 30) ?? ""}`
    : "nothing";
};

describe("times-ui: where the focus goes around the new team form (#2645, #2646)", () => {
  test("Novo time puts the focus in the Goal field", async () => {
    await open();
    await press("Novo time");
    await settleMaybe(() => focused() === screen.queryByLabelText("Objetivo"), 1500);
    expect(focused() === screen.queryByLabelText("Objetivo"), `focus is on ${where()}`).toBe(true);
  });

  test("Criar o primeiro time puts the focus in the Goal field", async () => {
    await open();
    await settle(() => screen.queryByText("Nenhum time ainda") !== null);
    await press("Criar o primeiro time");
    await settleMaybe(() => focused() === screen.queryByLabelText("Objetivo"), 1500);
    expect(focused() === screen.queryByLabelText("Objetivo"), `focus is on ${where()}`).toBe(true);
  });

  test("Cancelar puts the focus back on Novo time", async () => {
    await open();
    await press("Novo time");
    await press("Cancelar");
    const button = screen.queryByRole("button", { name: "Novo time" });
    expect(button).not.toBeNull();
    await settleMaybe(() => focused() === button, 1500);
    expect(focused() === button, `focus is on ${where()}`).toBe(true);
  });

  test("a created team puts the focus on Novo time, never on the page body", async () => {
    await open();
    await create("foco", "1");
    const button = screen.queryByRole("button", { name: "Novo time" });
    expect(button).not.toBeNull();
    await settleMaybe(() => focused() === button, 1500);
    expect(focused() === button, `focus is on ${where()}`).toBe(true);
  });

  test("removing a worker row puts the focus in the row that took its place", async () => {
    await open();
    await press("Novo time");
    await workerRows(3);
    await press("Remover a executora 2");
    await settle(() => screen.queryAllByLabelText(/^Modelo da executora \d+$/).length === 2);
    const next = screen.queryByLabelText("Persona da executora 2 (opcional)");
    expect(next).not.toBeNull();
    await settleMaybe(() => focused() === next, 1500);
    expect(focused() === next, `focus is on ${where()}`).toBe(true);
  });

  test("removing the last worker row puts the focus in the row before it", async () => {
    await open();
    await press("Novo time");
    await workerRows(3);
    await press("Remover a executora 3");
    await settle(() => screen.queryAllByLabelText(/^Modelo da executora \d+$/).length === 2);
    const before = screen.queryByLabelText("Persona da executora 2 (opcional)");
    await settleMaybe(() => focused() === before, 1500);
    expect(focused() === before, `focus is on ${where()}`).toBe(true);
  });

  test("adding the eighth worker row moves the focus to it, off the button that turns off", async () => {
    await open();
    await click("Novo time");
    await workerRows(7);
    await press("Adicionar executora ao novo time");
    await settle(() => screen.queryAllByLabelText(/^Modelo da executora \d+$/).length === 8);
    const eighth = screen.queryByLabelText("Persona da executora 8 (opcional)");
    expect(eighth).not.toBeNull();
    await settleMaybe(() => focused() === eighth, 1500);
    expect(focused() === eighth, `focus is on ${where()}`).toBe(true);
  });

  test("Remover on the only worker row is disabled and says why", async () => {
    await open();
    await click("Novo time");
    await workerRows(1);
    const button = screen.queryByRole("button", {
      name: "Remover a executora 1",
    }) as HTMLButtonElement | null;
    expect(button?.disabled).toBe(true);
    const reason = screen.queryByText("Um time precisa de pelo menos uma executora.");
    expect(reason).not.toBeNull();
    expect(button?.getAttribute("aria-describedby")).toBe(reason?.id ?? "?");
  });

  test("Adicionar executora is disabled at eight rows and says why", async () => {
    await open();
    await click("Novo time");
    await workerRows(8);
    const button = screen.queryByRole("button", {
      name: "Adicionar executora ao novo time",
    }) as HTMLButtonElement | null;
    expect(button?.disabled).toBe(true);
    const reason = screen.queryByText("Um time tem no máximo 8 executoras.");
    expect(reason).not.toBeNull();
    expect(button?.getAttribute("aria-describedby")).toBe(reason?.id ?? "?");
  });
});

describe("times-ui: the buttons of a team are named from their visible text (#2649)", () => {
  test("every button of a team row and of the form has a name that starts with its text", async () => {
    await open();
    await create("nomes", "1");
    await click("Novo time");
    const buttons = [
      ...(row("nomes") as HTMLElement).querySelectorAll("button"),
      ...(screen.queryByLabelText("Objetivo")?.closest("form")?.querySelectorAll("button") ?? []),
    ];
    // The team row has Pause, Add worker and Close, and its members' buttons.
    expect(buttons.length).toBeGreaterThan(6);
    const unmatched = buttons
      .map((button) => ({
        text: (button.textContent ?? "").trim().toLowerCase(),
        name: (button.getAttribute("aria-label") ?? "").trim().toLowerCase(),
      }))
      .filter(({ text, name }) => text !== "" && name !== "" && !name.startsWith(text));
    expect(unmatched).toEqual([]);
  });
});
