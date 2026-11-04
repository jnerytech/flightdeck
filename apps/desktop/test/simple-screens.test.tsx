import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { PlainInfo, TaskResultsResult } from "@flightdeck/protocol";
import { type AxeViolation, blocking, describeViolation } from "../../../scripts/lib/axe.ts";
import { BUILTIN_TEMPLATES } from "../../daemon/src/templates/builtin.ts";
import { type Lang, translator } from "../src/i18n/index.ts";
import { emptySession, type SessionState } from "../src/lib/session-state.ts";
import { hiddenTermsIn } from "../src/lib/simple-words.ts";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
const { act, cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const axe = (await import("axe-core")).default;
const { HomeView } = await import("../src/components/simple/home-view.tsx");
const { TaskView } = await import("../src/components/simple/task-view.tsx");
const { SettingsView } = await import("../src/components/simple/settings-view.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const LANGS: Lang[] = ["en", "pt-BR"];

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
const done = {
  kind: "result" as const,
  seq: 9,
  subtype: "success",
  isError: false,
  durationMs: 1000,
};
const said = {
  kind: "assistant" as const,
  seq: 2,
  blocks: [{ type: "text" as const, text: "All done." }],
};
const results: TaskResultsResult = {
  truncated: false,
  files: [
    {
      path: "/w/Flightdeck results/summary.md",
      name: "summary.md",
      sizeBytes: 2048,
      modifiedAt: "2026-11-03T10:00:00.000Z",
      change: "new",
    },
    {
      path: "/w/table.csv",
      name: "table.csv",
      sizeBytes: 40,
      modifiedAt: "2026-11-03T09:00:00.000Z",
      change: "changed",
    },
  ],
};

const SESSIONS: Record<string, SessionState> = {
  working: { ...emptySession(), status: "running", items: [{ kind: "user", seq: 1, text: "go" }] },
  waiting: {
    ...emptySession(),
    status: "awaiting_permission",
    pending: ["r1"],
    items: [{ kind: "permission", seq: 1, requestId: "r1", toolName: "Write", input: {}, plain }],
  },
  done: { ...emptySession(), status: "idle", items: [said, done] },
};

function task(
  name: keyof typeof SESSIONS,
  lang: Lang,
  preview?: { text: string; truncated: boolean },
) {
  render(
    <TaskView
      title="Summarise Notes"
      session={SESSIONS[name] as SessionState}
      results={name === "done" ? results : null}
      t={translator(lang, "simple")}
      locked={false}
      canOpen={true}
      onBack={() => {}}
      onStop={() => {}}
      onAnswer={() => {}}
      onOpenFull={() => {}}
      onCopy={() => {}}
      onOpenFile={() => {}}
      onRevealFile={() => {}}
      onPreview={async () => preview ?? null}
      onAskChanges={() => {}}
      onTryAgain={() => {}}
      onShowDetails={() => {}}
    />,
  );
}

function home(lang: Lang) {
  render(
    <HomeView
      templates={BUILTIN_TEMPLATES}
      tasks={[
        { sessionId: "a", title: "Summarise Notes", state: "waiting" },
        { sessionId: "b", title: "Tidy Reports", state: "done" },
      ]}
      t={translator(lang, "simple")}
      canPickFolder={false}
      onPickFolder={async () => null}
      onStart={async () => {}}
      onOpenTask={() => {}}
    />,
  );
}

function settings(lang: Lang) {
  render(
    <SettingsView
      t={translator(lang, "simple")}
      lang={lang}
      onLang={() => {}}
      theme="system"
      onTheme={() => {}}
      folders={["/home/ana/Reports"]}
      onAddFolder={async () => true}
      canPickFolder={false}
      onPickFolder={async () => null}
      notifications={true}
      onNotifications={() => {}}
      canSwitch={true}
      onShowEverything={() => {}}
    />,
  );
}

const SCREENS: Array<[string, (lang: Lang) => void]> = [
  ["Home", home],
  ["a working task", (lang) => task("working", lang)],
  ["a task that waits", (lang) => task("waiting", lang)],
  ["a done task with files", (lang) => task("done", lang)],
  ["Settings", settings],
];

/** Contrast needs real layout and colors: the prints' axe checks it. The rest runs here. */
async function violations(name: string): Promise<string[]> {
  const result = await axe.run(document.body, { rules: { "color-contrast": { enabled: false } } });
  return blocking(result.violations as AxeViolation[]).map((v) => describeViolation(name, v));
}

describe("simple-screens: every simple screen, in both languages", () => {
  for (const lang of LANGS) {
    for (const [name, show] of SCREENS) {
      test(`${name} is axe-clean and shows none of the hidden terms (${lang})`, async () => {
        show(lang);
        expect(await violations(`${name} ${lang}`)).toEqual([]);
        expect(hiddenTermsIn(document.body.textContent ?? "", lang)).toEqual([]);
      });
    }
  }

  test("the scan finds a hidden term when one is planted in the rendered text", () => {
    task("done", "en");
    const planted = `${document.body.textContent} Open the terminal`;
    expect(hiddenTermsIn(planted, "en")).toEqual(["terminal"]);
  });

  test("a CSV file opens in the inline preview, as text, before it opens in its program", async () => {
    task("done", "en", { text: "name,total\nrent,900", truncated: false });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open table.csv" }));
    });
    await waitFor(() => screen.getByRole("region", { name: "Preview of table.csv" }));
    expect(screen.getByRole("region", { name: "Preview of table.csv" }).textContent).toContain(
      "name,total",
    );
  });
});
