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

const { ApprovalCard } = await import("../src/components/approval/approval-card.tsx");

/** The key presses that must never approve: select-all and a held-down A. */
const NOT_APPROVE = [
  { key: "a", ctrlKey: true },
  { key: "a", metaKey: true },
  { key: "a", altKey: true },
  { key: "a", repeat: true },
];

// Issue #244 (H2): Ctrl+A or Cmd+A (select all) on a focused card approved it, and so did a held A.
describe("approval-keys: only a plain A approves from the keyboard", () => {
  test("the approval card: Ctrl, Cmd or Alt with A, or a held A, approve nothing; a plain A does", async () => {
    const calls: unknown[] = [];
    render(
      <ApprovalCard
        request={{
          requestId: "r1",
          toolName: "Bash",
          input: { command: "npm test" },
          cwd: "/repo",
          createdAt: "2026-10-29T12:00:00.000Z",
        }}
        t={translator("en")}
        nowMs={Date.parse("2026-10-29T12:01:00.000Z")}
        onRespond={(...args: unknown[]) => void calls.push(args)}
      />,
    );
    const group = screen.queryByRole("group", { name: "Request for Bash" }) as HTMLElement;
    expect(group).not.toBeNull();
    for (const press of NOT_APPROVE) {
      await act(async () => {
        fireEvent.keyDown(group, press);
      });
    }
    expect(calls).toEqual([]);
    await act(async () => {
      fireEvent.keyDown(group, { key: "a" });
    });
    expect(calls).toEqual([["allow"]]);
  });

  test("the simple question card: the same, Ctrl, Cmd or Alt with A, or a held A, answer nothing", async () => {
    const calls = setup(plain());
    const card = document.querySelector("fieldset.question-card") as HTMLElement;
    expect(card).not.toBeNull();
    for (const press of NOT_APPROVE) {
      await act(async () => {
        fireEvent.keyDown(card, press);
      });
    }
    expect(calls).toEqual([]);
  });
});
