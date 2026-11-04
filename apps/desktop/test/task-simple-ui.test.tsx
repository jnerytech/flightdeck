import { afterEach, describe, expect, test } from "bun:test";
import type { PlainInfo, TaskResultsResult } from "@flightdeck/protocol";
import { translator } from "../src/i18n/index.ts";
import { emptySession, type SessionState } from "../src/lib/session-state.ts";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
const { act, cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { TaskView } = await import("../src/components/simple/task-view.tsx");

afterEach(cleanup);

const plain: PlainInfo = {
  kind: "create",
  sentence: {
    en: "Create the file report.md in Reports",
    "pt-BR": "Criar o arquivo report.md em Reports",
  },
  consequence: {
    en: "This adds a new file. Nothing existing changes.",
    "pt-BR": "Isto adiciona um arquivo novo. Nada do que existe muda.",
  },
  reversible: true,
  outcome: "ask",
  hold: false,
};

const call = (id: string, name: string, input: object = {}) => ({
  type: "tool_use" as const,
  id,
  name,
  input,
});
const said = (text: string, seq = 2) => ({
  kind: "assistant" as const,
  seq,
  blocks: [{ type: "text" as const, text }],
});
const done = {
  kind: "result" as const,
  seq: 9,
  subtype: "success",
  isError: false,
  durationMs: 1000,
};

const files: TaskResultsResult = {
  truncated: false,
  files: [
    {
      path: "/w/Flightdeck results/report.md",
      name: "report.md",
      sizeBytes: 2048,
      modifiedAt: "2026-11-03T10:00:00.000Z",
      change: "new",
    },
    {
      path: "/w/budget.xlsx",
      name: "budget.xlsx",
      sizeBytes: 12,
      modifiedAt: "2026-11-03T09:00:00.000Z",
      change: "changed",
    },
  ],
};

function view(
  session: SessionState,
  over: {
    results?: TaskResultsResult | null;
    locked?: boolean;
    canOpen?: boolean;
    lang?: "en" | "pt-BR";
  } = {},
) {
  const calls: string[] = [];
  const log =
    (name: string) =>
    (...args: unknown[]) =>
      void calls.push(`${name}:${args.join(",")}`);
  render(
    <TaskView
      title="Summarise Notes"
      session={session}
      results={over.results ?? null}
      t={translator(over.lang ?? "en", "simple")}
      locked={over.locked ?? false}
      canOpen={over.canOpen ?? true}
      onBack={log("back")}
      onStop={log("stop")}
      onAnswer={log("answer")}
      onOpenFull={log("full")}
      onCopy={log("copy")}
      onOpenFile={log("open")}
      onRevealFile={log("reveal")}
      onPreview={async (path) =>
        path.endsWith(".md") ? { text: "# Report\nbody", truncated: true } : null
      }
      onAskChanges={log("ask")}
      onTryAgain={log("again")}
      onShowDetails={log("details")}
    />,
  );
  return calls;
}

describe("task-simple-ui: a task, not a transcript", () => {
  test("Given a working task, Then the header, a chip, Stop and the live sentence show, and no transcript or terminal", async () => {
    const calls = view({
      ...emptySession(),
      status: "running",
      items: [
        { kind: "user", seq: 1, text: "summarise" },
        {
          kind: "assistant",
          seq: 2,
          blocks: [
            call("a", "Read", { file_path: "/n/Notes/a.md" }),
            call("b", "Read", { file_path: "/n/Notes/b.md" }),
          ],
        },
        said("I am reading the notes now."),
      ],
    });
    expect(screen.getByRole("heading", { name: "Summarise Notes" })).toBeTruthy();
    expect(screen.getByText("Working")).toBeTruthy();
    expect(screen.getByRole("status", { name: "What is happening now" }).textContent).toBe(
      "Reading 2 files in Notes",
    );
    // The conversation is not shown, nor tools, nor terminal controls.
    expect(screen.queryByText("I am reading the notes now.")).toBeNull();
    expect(screen.queryByText("summarise")).toBeNull();
    expect(document.body.textContent).not.toMatch(/Read\b|Terminal|terminal/);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stop the task" }));
      fireEvent.click(screen.getByRole("button", { name: "Back" }));
    });
    expect(calls).toEqual(["stop:", "back:"]);
  });

  test("Given a task that waits, Then the question card shows and the answer goes with its request", async () => {
    const calls = view({
      ...emptySession(),
      status: "awaiting_permission",
      pending: ["r1"],
      items: [{ kind: "permission", seq: 1, requestId: "r1", toolName: "Write", input: {}, plain }],
    });
    expect(
      screen.getByText("Waiting for your answer", { selector: "[data-slot='task-chip']" }),
    ).toBeTruthy();
    expect(screen.getByText("Create the file report.md in Reports")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Yes, go ahead" }));
    });
    expect(calls).toEqual(["answer:r1,allow"]);
  });

  test("Given a done task, Then the summary and the files show, with New or Changed, and no Stop", () => {
    view(
      {
        ...emptySession(),
        status: "idle",
        items: [said("The report is ready.\n\nIt has three parts."), done],
      },
      { results: files },
    );
    expect(screen.getByText("Done", { selector: "[data-slot='task-chip']" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Summary" }).textContent).toContain(
      "The report is ready.",
    );
    expect(screen.queryByRole("button", { name: "Stop the task" })).toBeNull();
    const list = screen.getByRole("list", { name: "Files" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((row) => row.textContent),
    ).toEqual([expect.stringContaining("report.md"), expect.stringContaining("budget.xlsx")]);
    expect(within(list).getByText("New")).toBeTruthy();
    expect(within(list).getByText("Changed")).toBeTruthy();
    expect(within(list).getByText("2 KB")).toBeTruthy();
  });

  test("Given a done task with no files, Then it says so", () => {
    view(
      { ...emptySession(), status: "idle", items: [said("Nothing to write."), done] },
      { results: { files: [], truncated: false } },
    );
    expect(screen.getByText("This task made no files.")).toBeTruthy();
  });

  test("Given the files, When Open or Show in folder is pressed, Then the platform is asked for that file", async () => {
    const calls = view(
      { ...emptySession(), status: "idle", items: [said("ok"), done] },
      { results: files },
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open budget.xlsx" }));
      fireEvent.click(screen.getByRole("button", { name: "Show budget.xlsx in its folder" }));
    });
    expect(calls).toEqual(["open:/w/budget.xlsx", "reveal:/w/budget.xlsx"]);
  });

  test("Given a Markdown file, When it is opened, Then a preview shows first, says it is only the start, and Open goes on from there", async () => {
    const calls = view(
      { ...emptySession(), status: "idle", items: [said("ok"), done] },
      { results: files },
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open report.md" }));
    });
    const preview = await waitFor(() =>
      screen.getByRole("region", { name: "Preview of report.md" }),
    );
    expect(preview.textContent).toContain("body");
    expect(preview.textContent).toContain("This is only the start of the file.");
    expect(calls).toEqual([]);
    await act(async () => {
      fireEvent.click(within(preview).getByRole("button", { name: "Open report.md" }));
    });
    expect(calls).toEqual(["open:/w/Flightdeck results/report.md"]);
  });

  test("Given a browser that cannot open files, Then the files are listed without Open and Show in folder", () => {
    view(
      { ...emptySession(), status: "idle", items: [said("ok"), done] },
      { results: files, canOpen: false },
    );
    expect(screen.queryByRole("button", { name: "Open budget.xlsx" })).toBeNull();
    expect(screen.getByText("budget.xlsx")).toBeTruthy();
  });

  test("Given a done task, When changes are asked for, Then the message goes and the box empties", async () => {
    const calls = view(
      { ...emptySession(), status: "idle", items: [said("ok"), done] },
      { results: files },
    );
    const box = screen.getByRole("textbox", { name: "Ask for changes" }) as HTMLTextAreaElement;
    expect(box.placeholder).toBe("Make the summary shorter");
    fireEvent.change(box, { target: { value: "Make it shorter" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });
    expect(calls).toEqual(["ask:Make it shorter"]);
    expect(box.value).toBe("");
  });

  test("Given a failed task, Then a plain sentence with Try again and Show details, and nothing technical", async () => {
    const calls = view({
      ...emptySession(),
      status: "idle",
      items: [{ ...done, isError: true, subtype: "error_during_execution" }],
    });
    expect(
      screen.getByText("Claude could not finish. You can try again or change the request."),
    ).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/error_during_execution|exit code|stack/i);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      fireEvent.click(screen.getByRole("button", { name: "Show details" }));
    });
    expect(calls).toEqual(["again:", "details:"]);
  });

  test("Given a locked host, Then Show details is not offered", () => {
    view(
      { ...emptySession(), status: "idle", items: [{ ...done, isError: true }] },
      { locked: true },
    );
    expect(screen.queryByRole("button", { name: "Show details" })).toBeNull();
  });

  test("Given Portuguese, Then the whole screen reads in Portuguese", () => {
    view(
      { ...emptySession(), status: "idle", items: [said("Pronto."), done] },
      { results: files, lang: "pt-BR" },
    );
    expect(screen.getByText("Pronta", { selector: "[data-slot='task-chip']" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Resumo" })).toBeTruthy();
    expect(screen.getByRole("list", { name: "Arquivos" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Pedir mudanças" })).toBeTruthy();
  });

  test("Given an inline preview, When Close preview is pressed, Then the preview goes away", async () => {
    view({ ...emptySession(), status: "idle", items: [said("ok"), done] }, { results: files });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open report.md" }));
    });
    await waitFor(() => screen.getByRole("region", { name: "Preview of report.md" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Close preview" }));
    });
    expect(screen.queryByRole("region", { name: "Preview of report.md" })).toBeNull();
  });

  test("Given a done or a stopped task, When Show details is pressed, Then the full view is asked for", async () => {
    const finished = view(
      { ...emptySession(), status: "idle", items: [said("ok"), done] },
      { results: files },
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Show details" }));
    });
    expect(finished).toEqual(["details:"]);
    cleanup();
    const stopped = view({ ...emptySession(), status: "ended", items: [said("ok")] });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Show details" }));
    });
    expect(stopped).toEqual(["details:"]);
  });
});
