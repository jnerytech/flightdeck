import { afterEach, describe, expect, test } from "bun:test";
import type { HistoryToolDetail } from "@flightdeck/protocol";
import { liveScreen, registerDom } from "./dom.ts";
import { uiIdle } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { ToolRow } = await import("../src/components/session/tool-row.tsx");
const { TContext } = await import("../src/i18n/context.tsx");
const { translator } = await import("../src/i18n/index.ts");

afterEach(cleanup);

/** A row whose load answers `answer` and counts its calls (#606). */
function row(answer: () => Promise<HistoryToolDetail | null>, load = true) {
  const calls = { n: 0 };
  render(
    <TContext.Provider value={translator("en")}>
      <ToolRow
        name="Bash"
        input="ls -la"
        label="Tool Bash"
        load={
          load
            ? () => {
                calls.n++;
                return answer();
              }
            : undefined
        }
      />
    </TContext.Provider>,
  );
  return calls;
}

const button = () => screen.queryByRole("button", { name: /^Bash/ });
const press = async () => {
  const target = button();
  expect(target).not.toBeNull();
  await act(async () => {
    fireEvent.click(target as HTMLElement);
  });
  await uiIdle();
};
const text = () => document.body.textContent ?? "";

describe("tool-row-open: what a stored tool row says when it opens (#606)", () => {
  test("a host without history.tool keeps the plain row, with nothing to open", () => {
    row(async () => null, false);
    expect([button() === null, text().includes("ls -la")]).toEqual([true, true]);
  });

  test("an error result is red, a cut one says so, and closing and opening again reads once", async () => {
    const calls = row(async () => ({
      name: "Bash",
      input: '{\n  "command": "ls -la',
      result: { content: "ls: cannot access", isError: true },
      truncated: true,
    }));
    await press();
    const red = [...document.querySelectorAll("pre")].some(
      (pre) =>
        pre.textContent === "ls: cannot access" && pre.className.includes("text-status-error"),
    );
    expect([red, text().includes("Cut at 64 KB."), text().includes('"command": "ls -la')]).toEqual([
      true,
      true,
      true,
    ]);
    await press();
    expect(button()?.getAttribute("aria-expanded")).toBe("false");
    await press();
    expect([button()?.getAttribute("aria-expanded"), calls.n]).toEqual(["true", 1]);
  });

  test("a call the transcript no longer has, or a read that fails, says it could not be read", async () => {
    row(async () => null);
    await press();
    expect(text().includes("This call could not be read from the transcript.")).toBe(true);
    cleanup();
    row(() => Promise.reject(new Error("gone")));
    await press();
    expect(text().includes("This call could not be read from the transcript.")).toBe(true);
  });
});
