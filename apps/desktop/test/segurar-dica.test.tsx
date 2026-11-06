import { afterEach, describe, expect, test } from "bun:test";
import { translator } from "../src/i18n/index.ts";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
const { cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { HoldButton } = await import("../src/components/approval/hold-button.tsx");
const { QuestionCard } = await import("../src/components/simple/question-card.tsx");

afterEach(cleanup);

describe("Hold button hint (issue #238)", () => {
  test("Given a hint, Then the text is on screen and the button is described by it, not by a native title", () => {
    render(<HoldButton label="Hold" hint="Hold for 2 seconds" holdMs={30} onHeld={() => {}} />);
    const button = screen.getByRole("button", { name: "Hold" });
    const hint = screen.getByText("Hold for 2 seconds");
    expect(hint.id).not.toBe("");
    expect(button.getAttribute("aria-describedby")).toBe(hint.id);
    expect(button.hasAttribute("title")).toBe(false);
  });

  test("Given no hint, Then there is no description and no empty text node", () => {
    render(<HoldButton label="Hold" holdMs={30} onHeld={() => {}} />);
    const button = screen.getByRole("button", { name: "Hold" });
    expect(button.hasAttribute("aria-describedby")).toBe(false);
    expect(button.hasAttribute("title")).toBe(false);
  });

  test("Given two hold buttons with hints, Then each is described by its own text", () => {
    render(
      <>
        <HoldButton label="One" hint="First hint" holdMs={30} onHeld={() => {}} />
        <HoldButton label="Two" hint="Second hint" holdMs={30} onHeld={() => {}} />
      </>,
    );
    const one = screen.getByRole("button", { name: "One" }).getAttribute("aria-describedby");
    const two = screen.getByRole("button", { name: "Two" }).getAttribute("aria-describedby");
    expect(one).not.toBe(two);
  });

  test("Given a high-risk question in simple mode, Then the reason to hold is visible", () => {
    render(
      <QuestionCard
        plain={{
          kind: "delete",
          sentence: { en: "Delete Q3.docx", "pt-BR": "Apagar Q3.docx" },
          consequence: { en: "It cannot be undone.", "pt-BR": "Não dá para desfazer." },
          reversible: false,
          outcome: "ask",
          hold: true,
        }}
        t={translator("en", "simple")}
        locked={false}
        holdMs={30}
        onAnswer={() => {}}
        onOpenFull={() => {}}
        onCopy={() => {}}
      />,
    );
    expect(screen.getByText("Hold to say yes: this one is hard to undo.")).not.toBeNull();
  });
});
