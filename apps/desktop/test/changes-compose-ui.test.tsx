import { afterEach, describe, expect, test } from "bun:test";
import type { ChangesResult, ReviewComment } from "@flightdeck/protocol";
import { reviewMessage } from "@flightdeck/protocol";
import { translator } from "../src/i18n/index.ts";
import { registerDom } from "./dom.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { TContext } = await import("../src/i18n/context.tsx");
const { ChangesPanel } = await import("../src/ui/ChangesPanel.tsx");

afterEach(() => cleanup());

const t = translator("en");

const file = (path: string, lines: string[]) => ({
  path,
  oldPath: null,
  status: "modified" as const,
  additions: lines.length,
  deletions: 0,
  uncommitted: true,
  binary: false,
  hunks: [
    {
      header: `@@ -1,0 +1,${lines.length} @@`,
      oldStart: 1,
      newStart: 1,
      lines: lines.map((text) => ({ op: "+" as const, text })),
    },
  ],
});

const CHANGES = {
  target: "session:c1",
  root: "/work/api",
  base: null,
  position: null,
  files: [file("app.ts", ["const total = a + b;", "return total;"]), file("cart.ts", ["add(x);"])],
} as unknown as ChangesResult;

/** A store that answers what the panel asks of a host, with the comments the test keeps. */
function fakeStore(comments: ReviewComment[] = []) {
  const calls: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const store = {
    hostRequest: async () => ({ ok: true, data: CHANGES }),
    hostCommand: async (_host: string, type: string, payload: Record<string, unknown>) => {
      calls.push({ type, payload });
      if (type === "review.list") return { comments };
      if (type === "review.add") {
        const added = { ...payload, id: `c${comments.length + 1}`, state: "draft" } as never;
        comments.push({
          id: `c${comments.length + 1}`,
          target: String(payload.target),
          path: String(payload.path),
          side: "new",
          lineStart: Number(payload.lineStart),
          lineEnd: Number(payload.lineEnd),
          quote: "q",
          body: String(payload.body),
          state: "draft",
          createdAt: "2026-11-08T10:00:00Z",
          sentAt: null,
          outdated: false,
        });
        return added;
      }
      if (type === "review.send")
        return { via: "session", text: "sent", comments: comments.length };
      return null;
    },
    watchChanges: () => () => {},
    canOpenPaths: () => false,
    later: () => () => {},
    now: () => Date.now(),
    success: () => {},
    copyText: async () => {},
  };
  return { store: store as never, calls };
}

const draft = (id: string, path: string, line: number, body: string): ReviewComment => ({
  id,
  target: "session:c1",
  path,
  side: "new",
  lineStart: line,
  lineEnd: line,
  quote: `line ${line}`,
  body,
  state: "draft",
  createdAt: `2026-11-08T10:0${id.slice(1)}:00Z`,
  sentAt: null,
  outdated: false,
});

async function show(over: { comments?: ReviewComment[]; onCompose?: (text: string) => void } = {}) {
  const fake = fakeStore(over.comments ?? []);
  render(
    <TContext.Provider value={t}>
      <ChangesPanel
        store={fake.store}
        hostId="h1"
        target="session:c1"
        {...(over.onCompose ? { onCompose: over.onCompose } : {})}
      />
    </TContext.Provider>,
  );
  await act(async () => {});
  return fake;
}

const pick = async (label: string) => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: label }));
  });
};

describe("changes-compose-ui: commenting by keyboard, and a review put in the message box (#1146)", () => {
  test("every line number offers a visible Comment affordance", async () => {
    await show();
    const button = screen.getByRole("button", { name: "Comment on line 1 of app.ts" });
    expect(button.querySelector("[data-slot='comment-affordance']") !== null).toBe(true);
    expect(button.getAttribute("title")).toBe("Comment on line 1 of app.ts");
  });

  test("picking a line puts the focus in the comment box", async () => {
    await show();
    await pick("Comment on line 2 of app.ts");
    const box = screen.getByRole("textbox", { name: "Comment" });
    expect(document.activeElement === box).toBe(true);
  });

  test("Ctrl+Enter adds the comment, and an empty one is not added", async () => {
    const { calls } = await show();
    await pick("Comment on line 2 of app.ts");
    const box = screen.getByRole("textbox", { name: "Comment" });
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    });
    expect(calls.some((c) => c.type === "review.add")).toBe(false);
    await act(async () => {
      fireEvent.change(box, { target: { value: "use total" } });
    });
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    });
    const added = calls.find((c) => c.type === "review.add");
    expect(added?.payload).toMatchObject({
      path: "app.ts",
      lineStart: 2,
      lineEnd: 2,
      body: "use total",
    });
    expect(screen.queryByRole("textbox", { name: "Comment" }) === null).toBe(true);
  });

  test("Esc closes the comment box and keeps nothing", async () => {
    const { calls } = await show();
    await pick("Comment on line 1 of cart.ts");
    const box = screen.getByRole("textbox", { name: "Comment" });
    await act(async () => {
      fireEvent.change(box, { target: { value: "half a thought" } });
      fireEvent.keyDown(box, { key: "Escape" });
    });
    expect(screen.queryByRole("textbox", { name: "Comment" }) === null).toBe(true);
    expect(calls.some((c) => c.type === "review.add")).toBe(false);
  });

  test("Esc and adding a comment return the focus to the line that was picked", async () => {
    await show();
    const line = screen.getByRole("button", { name: "Comment on line 2 of app.ts" });
    await act(async () => {
      line.focus();
      fireEvent.click(line);
    });
    const box = screen.getByRole("textbox", { name: "Comment" });
    await act(async () => {
      fireEvent.keyDown(box, { key: "Escape" });
    });
    expect(document.activeElement === line).toBe(true);
    await act(async () => {
      line.focus();
      fireEvent.click(line);
    });
    await act(async () => {
      fireEvent.change(screen.getByRole("textbox", { name: "Comment" }), {
        target: { value: "use total" },
      });
      fireEvent.keyDown(screen.getByRole("textbox", { name: "Comment" }), {
        key: "Enter",
        ctrlKey: true,
      });
    });
    expect(document.activeElement === line).toBe(true);
  });

  test("with drafts, Review in the message box hands over the review as one message and sends nothing", async () => {
    const comments = [draft("c1", "app.ts", 2, "use total"), draft("c2", "cart.ts", 1, "name it")];
    const handed: string[] = [];
    const { calls } = await show({ comments, onCompose: (text) => handed.push(text) });
    expect(screen.getByRole("button", { name: "Send review (2)" })).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Review in the message box (2)" }));
    });
    expect(handed).toEqual([reviewMessage(comments, "en")]);
    expect(handed[0]).toContain("`app.ts` line 2");
    expect(handed[0]).toContain("`cart.ts` line 1");
    expect(calls.some((c) => c.type === "review.send")).toBe(false);
  });

  test("Send review asks the host for the review in the app's language", async () => {
    const { calls } = await show({ comments: [draft("c1", "app.ts", 2, "use total")] });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send review (1)" }));
    });
    expect(calls.filter((c) => c.type === "review.send").map((c) => c.payload.language)).toEqual([
      "en",
    ]);
  });

  test("a panel with nowhere to hand the review over (a card) keeps only the direct send", async () => {
    await show({ comments: [draft("c1", "app.ts", 2, "use total")] });
    expect(screen.getByRole("button", { name: "Send review (1)" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /message box/ }) === null).toBe(true);
  });
});
