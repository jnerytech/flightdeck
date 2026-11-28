import { afterEach, describe, expect, test } from "bun:test";
import type { AutoApprovalRecord, AutoApproveSuspension } from "@flightdeck/protocol";
import { registerDom } from "../dom.ts";
import { uiIdle } from "../wait.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const { translator } = await import("../../src/i18n/index.ts");
const { AutoApprovalsPage } = await import("../../src/features/permissions/page.tsx");

import type { AppStore } from "../../src/lib/app-store.ts";

afterEach(cleanup);

type Listed = { decisions: AutoApprovalRecord[]; suspended: AutoApproveSuspension[] };
type Answer = { ok: true; data: Listed } | { ok: false; code: string; message: string };

const decision = (id: string, toolName: string): AutoApprovalRecord => ({
  id,
  projectId: "p1",
  sessionKey: "s1",
  requestId: `r-${id}`,
  toolName,
  risk: "low",
  decision: "allow",
  reason: `reason of ${id}`,
  by: "rule",
  model: null,
  at: "2026-11-22T10:00:00.000Z",
});
const SUSPENDED: AutoApproveSuspension = {
  sessionKey: "sess-1",
  reason: "too many asks",
  at: "2026-11-22T10:00:00.000Z",
};
const listed = (
  decisions: AutoApprovalRecord[],
  suspended: AutoApproveSuspension[] = [],
): Answer => ({
  ok: true,
  data: { decisions, suspended },
});
const refused = (message: string): Answer => ({ ok: false, code: "host_refused", message });

/** A promise the test settles by hand, so a wait on the host can be looked at. */
function pending() {
  let settle: (answer: Answer) => void = () => {};
  const promise = new Promise<Answer>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

/**
 * A store that answers `autoapprove.list` from `lists`, in order, and `autoapprove.resume` from
 * `resumes`. The list is read through `hostCommand` or `hostRequest`: both answer from the script.
 */
function fakeStore(
  lists: Array<Promise<Answer> | Answer>,
  resumes: Array<Promise<Answer> | Answer> = [],
  language: "en" | "pt-BR" = "en",
) {
  const sent: Array<{ command: string; payload: unknown }> = [];
  const next = async (command: string, payload: unknown) => {
    sent.push({ command, payload });
    const script = command === "autoapprove.list" ? lists : resumes;
    const answer = script.shift();
    if (!answer) throw new Error(`no answer scripted for ${command}`);
    return answer;
  };
  const store = {
    hostRequest: (_host: string, command: string, payload: unknown) => next(command, payload),
    hostCommand: async (_host: string, command: string, payload: unknown) => {
      const answer = await next(command, payload);
      return answer.ok ? answer.data : null;
    },
    projectList: { load: async () => {} },
    approval: {
      resumePayload: async () => ({ kind: "payload", payload: { sessionKey: "sess-1" } }),
    },
    getState: () => ({
      projects: {
        h: [
          { id: "p1", name: "alfa" },
          { id: "p2", name: "beta" },
        ],
      },
    }),
    formatDateTime: (iso: string) => iso,
    reportError: () => {},
    i18n: { t: translator(language) },
  } as unknown as AppStore;
  return { store, sent };
}

const view = (store: AppStore) => render(<AutoApprovalsPage store={store} hostId="h" />);
const text = (container: HTMLElement) => container.textContent ?? "";
const press = async (scope: HTMLElement, name: string | RegExp) => {
  const button = within(scope).queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};
const confirmResume = async () => {
  const dialog = within(document.body).queryByRole("alertdialog");
  expect(dialog).not.toBeNull();
  await press(dialog as HTMLElement, "Resume");
};

describe("automatic approvals page: what it says when the host refuses or is slow (#4160)", () => {
  test("a refused list shows its message and Try again, not Loading; pressing it shows the decisions", async () => {
    const { store } = fakeStore([
      refused("the host cannot read the log"),
      listed([decision("d1", "Bash")]),
    ]);
    const { container } = view(store);
    await uiIdle();
    expect({
      alert: within(container).queryByRole("alert")?.textContent?.includes("cannot read") ?? false,
      loading: within(container).queryByRole("status", { name: "Loading the decisions" }) !== null,
    }).toEqual({ alert: true, loading: false });
    await press(container, "Try again");
    await uiIdle();
    expect(text(container)).toContain("reason of d1");
  });

  test("changing the project drops the old project's rows and shows the loading line until the answer", async () => {
    const second = pending();
    const { store, sent } = fakeStore([listed([decision("d1", "Bash")]), second.promise]);
    const { container } = view(store);
    await uiIdle();
    expect(text(container)).toContain("reason of d1");
    await act(async () => {
      fireEvent.change(within(container).getByLabelText("Project"), { target: { value: "p2" } });
    });
    await uiIdle();
    expect({
      stale: text(container).includes("reason of d1"),
      loading: within(container).queryByRole("status", { name: "Loading the decisions" }) !== null,
      asked: sent.map((s) => s.payload),
    }).toEqual({ stale: false, loading: true, asked: [{}, { projectId: "p2" }] });
    await act(async () => second.settle(listed([decision("d2", "Edit")])));
    await uiIdle();
    expect(text(container)).toContain("reason of d2");
  });

  test("a confirmed Resume not answered yet turns its button busy and off, and sends once", async () => {
    const resume = pending();
    const { store, sent } = fakeStore([listed([], [SUSPENDED])], [resume.promise]);
    const { container } = view(store);
    await uiIdle();
    await press(container, /^Resume sess-1/);
    await confirmResume();
    await uiIdle();
    const button = within(container).queryByRole("button", { name: /^Resume sess-1/ });
    expect({
      busy: button?.getAttribute("aria-busy"),
      off: (button as HTMLButtonElement | null)?.disabled,
    }).toEqual({ busy: "true", off: true });
    await act(async () => {
      fireEvent.click(button as HTMLElement);
    });
    expect(sent.filter((s) => s.command === "autoapprove.resume").length).toBe(1);
  });

  test("while the list is not read, 'No suspended sessions' is not said", async () => {
    const first = pending();
    const { store } = fakeStore([first.promise, refused("the host cannot read the log")]);
    const { container } = view(store);
    await uiIdle();
    const whileLoading = text(container).includes("No suspended sessions");
    await act(async () => first.settle(refused("the host cannot read the log")));
    await uiIdle();
    expect({
      whileLoading,
      afterRefusal: text(container).includes("No suspended sessions"),
    }).toEqual({ whileLoading: false, afterRefusal: false });
  });

  test("after Try again the focus stays on the page's content, not on the body", async () => {
    const { store } = fakeStore([
      refused("the host cannot read the log"),
      listed([decision("d1", "Bash")]),
    ]);
    const { container } = view(store);
    await uiIdle();
    await press(container, "Try again");
    await uiIdle();
    expect(
      document.activeElement !== document.body && container.contains(document.activeElement),
    ).toBe(true);
  });

  test("while one Resume is out, the other suspended session's button is off too", async () => {
    const resume = pending();
    const other: AutoApproveSuspension = { ...SUSPENDED, sessionKey: "sess-2" };
    const { store } = fakeStore([listed([], [SUSPENDED, other])], [resume.promise]);
    const { container } = view(store);
    await uiIdle();
    await press(container, /^Resume sess-1/);
    await confirmResume();
    await uiIdle();
    const second = within(container).queryByRole("button", { name: /^Resume sess-2/ });
    expect((second as HTMLButtonElement | null)?.disabled).toBe(true);
  });

  test("after a Resume that worked the focus is inside the suspended list, not on the page", async () => {
    const { store } = fakeStore([listed([], [SUSPENDED])], [listed([], [])]);
    const { container } = view(store);
    await uiIdle();
    await press(container, /^Resume sess-1/);
    await confirmResume();
    await uiIdle();
    const group = within(container).queryByRole("region", { name: "Suspended sessions" });
    expect({
      gone: within(container).queryByRole("button", { name: /^Resume sess-1/ }) === null,
      focused: group?.contains(document.activeElement) ?? false,
    }).toEqual({ gone: true, focused: true });
  });

  test("in pt-BR the retry is in Portuguese", async () => {
    const { store } = fakeStore([refused("falhou")], [], "pt-BR");
    const { container } = view(store);
    await uiIdle();
    expect(within(container).queryByRole("button", { name: "Tentar de novo" }) !== null).toBe(true);
  });
});

const WORDS = {
  en: {
    filter: "Filter decisions",
    noMatch: "No decision matches the filter",
    clear: "Clear filter",
  },
  "pt-BR": {
    filter: "Filtrar decisões",
    noMatch: "Nenhuma decisão corresponde ao filtro",
    clear: "Limpar filtro",
  },
} as const;

describe.each(["en", "pt-BR"] as const)(
  "automatic approvals page, %s: a filter that matches nothing is announced and can be cleared (#4491)",
  (lang) => {
    const w = WORDS[lang];

    test("a filter that matches nothing says so in a status and offers Clear filter, which shows the list again", async () => {
      const { store } = fakeStore([listed([decision("d1", "Bash")])], [], lang);
      const { container } = view(store);
      await uiIdle();
      const field = within(container).getByLabelText(w.filter) as HTMLInputElement;
      expect(within(container).queryByRole("status")?.textContent ?? "").toBe("");
      await act(async () => {
        fireEvent.change(field, { target: { value: "zzz" } });
      });
      await uiIdle();
      const said = within(container).queryByRole("status")?.textContent ?? "";
      const clear = within(container).queryByRole("button", { name: w.clear });
      expect({ said, hasClear: clear !== null }).toEqual({ said: w.noMatch, hasClear: true });
      await press(container, w.clear);
      await uiIdle();
      expect({
        listed: text(container).includes("reason of d1"),
        field: field.value,
        focused: document.activeElement?.isSameNode(field) ?? false,
      }).toEqual({ listed: true, field: "", focused: true });
    });
  },
);

describe("automatic approvals page: a long session key does not widen the row (#4492)", () => {
  test("the key wraps inside its column instead of pushing Resume out of a narrow window", async () => {
    const long = { ...SUSPENDED, sessionKey: "host-1/6f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f" };
    const { store } = fakeStore([listed([], [long])]);
    const { container } = view(store);
    await uiIdle();
    const key = within(container).queryByText(long.sessionKey);
    expect({
      key: key?.className.includes("break-all") ?? false,
      column: key?.parentElement?.className.includes("min-w-0") ?? false,
    }).toEqual({ key: true, column: true });
  });
});
