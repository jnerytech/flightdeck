import { afterEach, describe, expect, test } from "bun:test";
import type { PlainInfo } from "@flightdeck/protocol";
import { translator } from "../src/i18n/index.ts";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { QuestionCard } = await import("../src/components/simple/question-card.tsx");

afterEach(cleanup);

const plain = (over: Partial<PlainInfo> = {}): PlainInfo => ({
  kind: "create",
  sentence: {
    en: "Create the file Q3 report.docx in Reports",
    "pt-BR": "Criar o arquivo Q3 report.docx em Reports",
  },
  consequence: {
    en: "This adds a new file. Nothing existing changes.",
    "pt-BR": "Isto adiciona um arquivo novo. Nada do que existe muda.",
  },
  reversible: true,
  outcome: "ask",
  hold: false,
  ...over,
});

function setup(info: PlainInfo, lang: "en" | "pt-BR" = "en", locked = false, holdMs = 30) {
  const calls: string[] = [];
  render(
    <QuestionCard
      plain={info}
      t={translator(lang, "simple")}
      locked={locked}
      holdMs={holdMs}
      onAnswer={(decision) => void calls.push(decision)}
      onOpenFull={() => void calls.push("full")}
      onCopy={(text) => void calls.push(`copy:${text}`)}
    />,
  );
  return calls;
}

describe("question-card-ui: a question, not an approval", () => {
  test("Given a request, Then the card says what Claude wants and what it means, with two buttons", () => {
    setup(plain());
    expect(screen.getByText("Create the file Q3 report.docx in Reports")).toBeTruthy();
    expect(screen.getByText("This adds a new file. Nothing existing changes.")).toBeTruthy();
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Yes, go ahead",
      "No, don't",
    ]);
  });

  test("Given Portuguese, Then the card reads in Portuguese", () => {
    setup(plain(), "pt-BR");
    expect(screen.getByText("Criar o arquivo Q3 report.docx em Reports")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sim, pode continuar" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Não" })).toBeTruthy();
  });

  test("When yes or no is pressed, Then the answer is allow or deny", async () => {
    const calls = setup(plain());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Yes, go ahead" }));
      fireEvent.click(screen.getByRole("button", { name: "No, don't" }));
    });
    expect(calls).toEqual(["allow", "deny"]);
  });

  test("When A, N or Esc is pressed on the card, Then A allows and N and Esc deny", async () => {
    const calls = setup(plain());
    const card = screen.getByRole("group", { name: "Create the file Q3 report.docx in Reports" });
    await act(async () => {
      fireEvent.keyDown(card, { key: "a" });
      fireEvent.keyDown(card, { key: "n" });
      fireEvent.keyDown(card, { key: "Escape" });
    });
    expect(calls).toEqual(["allow", "deny", "deny"]);
  });

  test("Given a high-risk question, Then the yes is held: a click and the A key do nothing, holding does", async () => {
    const calls = setup(plain({ hold: true, reversible: false }));
    const yes = screen.getByRole("button", { name: "Yes, go ahead" });
    const card = screen.getByRole("group", { name: "Create the file Q3 report.docx in Reports" });
    await act(async () => {
      fireEvent.click(yes);
      fireEvent.keyDown(card, { key: "a" });
    });
    expect(calls).toEqual([]);
    await act(async () => {
      fireEvent.pointerDown(yes);
      await Bun.sleep(60);
    });
    expect(calls).toEqual(["allow"]);
    // No is never held.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "No, don't" }));
    });
    expect(calls).toEqual(["allow", "deny"]);
  });

  test("Given a request that needs full access, Then there is no yes or no, only what to do next", async () => {
    const calls = setup(plain({ outcome: "needs_full_access" }));
    expect(screen.getByText("This needs someone with full access")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Yes, go ahead" })).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open in full mode" }));
      fireEvent.click(screen.getByRole("button", { name: "Copy a message for the administrator" }));
    });
    expect(calls).toEqual([
      "full",
      "copy:A task is waiting for someone with full access: Create the file Q3 report.docx in Reports",
    ]);
  });

  test("Given a locked host, Then a request that needs full access offers no way to full mode", () => {
    setup(plain({ outcome: "needs_full_access" }), "en", true);
    expect(screen.queryByRole("button", { name: "Open in full mode" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Copy a message for the administrator" }),
    ).toBeTruthy();
  });
});
