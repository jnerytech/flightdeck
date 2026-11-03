import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { PermissionResolution } from "@flightdeck/protocol";
import { translator } from "../src/i18n/index.ts";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { ApprovalCard } = await import("../src/components/approval/approval-card.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const t = translator("en");
const NOW = Date.parse("2026-11-02T12:00:00.000Z");

const INPUT = {
  questions: [
    {
      question: "Which database?",
      header: "Database",
      multiSelect: false,
      options: [
        { label: "SQLite", description: "Embedded" },
        { label: "Postgres", description: "Server" },
      ],
    },
  ],
};

type Resolution = { decision: PermissionResolution; message?: string };

function tree(
  input: Record<string, unknown>,
  resolution?: Resolution,
  toolName = "AskUserQuestion",
) {
  return (
    <ApprovalCard
      request={{ requestId: "r1", toolName, input, cwd: null, createdAt: null, risk: "medium" }}
      t={t}
      nowMs={NOW}
      {...(resolution ? { resolution } : {})}
      onRespond={() => undefined}
    />
  );
}

describe("pergunta-recolhida", () => {
  test("once answered, the card is a compact row with the header and the chosen answer", async () => {
    const view = render(tree(INPUT));
    await act(async () => {
      fireEvent.click(screen.queryByRole("radio", { name: /Postgres/ }) as HTMLElement);
    });
    view.rerender(tree(INPUT, { decision: "allow" }));
    expect(screen.queryByRole("button", { name: "Send answers" })).toBeNull();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    const row = document.querySelector("details[data-answered]") as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.querySelector("summary")?.textContent).toContain("Database");
    expect(row.querySelector("summary")?.textContent).toContain("Postgres");
    expect(row.hasAttribute("open")).toBe(false);
    expect(row.textContent).toContain("Which database?");
  });

  test("an answered card whose picks are gone (a reload) is still a compact row", () => {
    render(tree(INPUT, { decision: "allow" }));
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    const summary = document.querySelector("details[data-answered] summary");
    expect(summary?.textContent).toContain("Database");
    expect(summary?.textContent).toContain("approved");
  });

  test("a denied question is a compact row too", () => {
    render(tree(INPUT, { decision: "deny" }));
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(document.querySelector("details[data-answered] summary")?.textContent).toContain(
      "denied",
    );
  });
});

describe("pergunta-titulo", () => {
  test('AskUserQuestion reads "Claude asks", with no risk seal', () => {
    render(tree(INPUT));
    expect(document.body.textContent).toContain("Claude asks");
    expect(document.body.textContent).not.toContain("Permission for");
    expect(document.querySelector("[data-risk]")).toBeNull();
  });

  test('ExitPlanMode reads "Claude proposes a plan", with no risk seal', () => {
    render(tree({ plan: "# P" }, undefined, "ExitPlanMode"));
    expect(document.body.textContent).toContain("Claude proposes a plan");
    expect(document.querySelector("[data-risk]")).toBeNull();
  });

  test("any other tool keeps its permission title and risk seal", () => {
    render(tree({ command: "ls" }, undefined, "Bash"));
    expect(document.body.textContent).toContain("Permission for");
    expect(document.querySelector("[data-risk]")).not.toBeNull();
  });
});
