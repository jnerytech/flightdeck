import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settleMaybe } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { TContext } = await import("../src/i18n/context.tsx");
const { AlertPicker } = await import("../src/components/workflows/alert-picker.tsx");
const { CardStartDialog } = await import("../src/components/board/card-start-dialog.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const CODE = {
  id: "code-scanning:12",
  kind: "code-scanning",
  number: 12,
  severity: "high",
  title: "Database query built from user-controlled sources",
  location: "src/db.ts:41",
  url: "https://github.com/o/r/security/code-scanning/12",
  text: "Code scanning alert #12 (high): Database query built from user-controlled sources\nWhere: src/db.ts:41",
};
const DEP = {
  id: "dependabot:5",
  kind: "dependabot",
  number: 5,
  severity: "critical",
  title: "Prototype pollution in lodash",
  location: "package.json",
  url: "https://github.com/o/r/security/dependabot/5",
  text: "Dependabot alert #5 (critical): Prototype pollution in lodash",
};

type Answer = () => Promise<unknown>;

function host(features: string[]) {
  return {
    id: "h1",
    name: "alfa",
    url: "ws://x",
    token: "",
    status: "online",
    info: null,
    hostInfo: { daemonVersion: "x", features },
    incompatibility: null,
    daemonUpdate: null,
    sessions: [],
  };
}

function setup(
  options: {
    language?: "en" | "pt-BR";
    features?: string[];
    alerts?: Answer;
    workflows?: Array<{ name: string; inputs: string[] }>;
    dialog?: boolean;
  } = {},
) {
  const store = new AppStore(memoryPlatform(false, options.language ?? "en").platform, {
    baseDelayMs: 600_000,
  });
  store.i18n.start();
  (store as unknown as { update(p: object): void }).update({
    hosts: [host(options.features ?? ["alerts"])],
  });
  const sent: Array<[string, string, unknown]> = [];
  const picked: string[] = [];
  store.hostCommand = (async (hostId: string, type: string, payload: unknown) => {
    sent.push([hostId, type, payload]);
    if (type === "alert.list") {
      return options.alerts ? options.alerts() : { alerts: [CODE, DEP], unavailable: [] };
    }
    if (type === "workflow.list") {
      const workflows = options.workflows ?? [{ name: "alert-fixer", inputs: ["alert"] }];
      return {
        workflows: workflows.map((w) => ({
          ...w,
          hash: "h",
          trusted: true,
          checks: [],
          errors: [],
        })),
      };
    }
    return null;
  }) as never;
  render(
    <TContext.Provider value={store.i18n.t}>
      {options.dialog ? (
        <CardStartDialog
          store={store}
          hostId="h1"
          card={{ id: "c1", projectId: "p1", title: "Fix an alert" }}
          onClose={() => {}}
          onStarted={() => {}}
        />
      ) : (
        <AlertPicker
          store={store}
          hostId="h1"
          projectId="p1"
          onPick={(text) => picked.push(text)}
        />
      )}
    </TContext.Provider>,
  );
  const asked = () => sent.filter(([, type]) => type === "alert.list");
  return { store, picked, asked };
}

const click = (el: Element) =>
  act(async () => {
    fireEvent.click(el);
  });
const button = (name: string) => screen.queryByRole("button", { name });
async function press(name: string) {
  const target = button(name);
  expect(target !== null).toBe(true);
  if (target) await click(target);
}
const dialog = (name: string) => screen.queryByRole("dialog", { name });
const listed = () => screen.queryByRole("list", { name: "Alerts" });

async function open() {
  await press("Choose an alert");
  await settleMaybe(() => listed() !== null);
}

describe("Choose an alert (issue #79)", () => {
  test("a host that cannot read alerts gets no button", () => {
    setup({ features: [] });
    expect(button("Choose an alert") === null).toBe(true);
  });

  test("the button is there with the feature, and the host is asked only when it opens", async () => {
    const { asked } = setup();
    expect(button("Choose an alert") !== null).toBe(true);
    expect(asked().length).toBe(0);
    await press("Choose an alert");
    await settleMaybe(() => asked().length === 1);
    expect(asked()).toEqual([["h1", "alert.list", { projectId: "p1" }]]);
  });

  test("each alert shows its severity in words, its title and where it is, in the host's order", async () => {
    setup();
    await open();
    expect(dialog("Choose an alert") !== null).toBe(true);
    const items = within(listed() ?? document.body).queryAllByRole("listitem");
    expect(items.length).toBe(2);
    const first = within(items[0] as HTMLElement);
    expect(first.queryByText("High") !== null).toBe(true);
    expect(first.queryByText(CODE.title) !== null).toBe(true);
    expect(first.queryByText("src/db.ts:41") !== null).toBe(true);
    const second = within(items[1] as HTMLElement);
    expect(second.queryByText("Critical") !== null).toBe(true);
    expect(second.queryByText("Prototype pollution in lodash") !== null).toBe(true);
    expect(button(`Use alert ${CODE.title}`) !== null).toBe(true);
  });

  test("while the host answers, the dialog says it is loading", async () => {
    setup({ alerts: () => new Promise(() => {}) });
    await press("Choose an alert");
    expect(screen.queryByRole("status", { name: "Loading alerts" }) !== null).toBe(true);
  });

  test("a host that does not answer says so", async () => {
    setup({ alerts: async () => null });
    await press("Choose an alert");
    await settleMaybe(() => screen.queryByText(/Could not read the alerts/) !== null);
    expect(screen.queryByText(/Could not read the alerts/) !== null).toBe(true);
    expect(listed() === null).toBe(true);
  });

  test("a source that could not be read is said, by name and by reason, beside the others", async () => {
    setup({
      alerts: async () => ({
        alerts: [DEP],
        unavailable: [{ kind: "code-scanning", reason: "unavailable" }],
      }),
    });
    await open();
    expect(
      screen.queryByText(
        "Code scanning: not available for this repository. It may be off, or gh on the host may lack access.",
      ) !== null,
    ).toBe(true);
    expect(button("Use alert Prototype pollution in lodash") !== null).toBe(true);
  });

  test("each reason has its own words", async () => {
    setup({
      alerts: async () => ({
        alerts: [],
        unavailable: [
          { kind: "code-scanning", reason: "gh_missing" },
          { kind: "dependabot", reason: "not_signed_in" },
        ],
      }),
    });
    await press("Choose an alert");
    await settleMaybe(() => screen.queryByText(/not installed/) !== null);
    expect(
      screen.queryByText("Code scanning: the GitHub CLI (gh) is not installed on the host.") !==
        null,
    ).toBe(true);
    expect(
      screen.queryByText("Dependabot: gh on the host is not signed in to an account.") !== null,
    ).toBe(true);
  });

  test("with no alerts and nothing unreadable, it says there are none", async () => {
    setup({ alerts: async () => ({ alerts: [], unavailable: [] }) });
    await press("Choose an alert");
    await settleMaybe(() => screen.queryByText("No open alerts.") !== null);
    expect(screen.queryByText("No open alerts.") !== null).toBe(true);
  });

  test("with no alerts because a source failed, it does not claim there are none", async () => {
    setup({
      alerts: async () => ({
        alerts: [],
        unavailable: [{ kind: "dependabot", reason: "failed" }],
      }),
    });
    await press("Choose an alert");
    await settleMaybe(() => screen.queryByText("Dependabot: could not be read.") !== null);
    expect(screen.queryByText("Dependabot: could not be read.") !== null).toBe(true);
    expect(screen.queryByText("No open alerts.") === null).toBe(true);
  });

  test("picking one hands its text over, closes the dialog and gives the focus back", async () => {
    const { picked } = setup();
    await open();
    await press(`Use alert ${CODE.title}`);
    await settleMaybe(() => dialog("Choose an alert") === null);
    expect(picked).toEqual([CODE.text]);
    await settleMaybe(() => document.activeElement === button("Choose an alert"));
    expect(document.activeElement === button("Choose an alert")).toBe(true);
  });

  test("Escape closes the dialog and picks nothing", async () => {
    const { picked } = setup();
    await open();
    const shown = dialog("Choose an alert");
    expect(shown !== null).toBe(true);
    await act(async () => {
      fireEvent.keyDown(shown ?? document.body, { key: "Escape" });
    });
    await settleMaybe(() => dialog("Choose an alert") === null);
    expect(picked).toEqual([]);
    expect(dialog("Choose an alert") === null).toBe(true);
  });

  test("in Portuguese the button, the dialog and the reasons follow the language", async () => {
    setup({
      language: "pt-BR",
      alerts: async () => ({
        alerts: [CODE],
        unavailable: [{ kind: "dependabot", reason: "unavailable" }],
      }),
    });
    await press("Escolher um alerta");
    await settleMaybe(() => screen.queryByRole("list", { name: "Alertas" }) !== null);
    expect(dialog("Escolher um alerta") !== null).toBe(true);
    expect(screen.queryByText("Alto") !== null).toBe(true);
    expect(
      screen.queryByText(
        "Dependabot: indisponível neste repositório. Pode estar desligado, ou o gh do host pode não ter acesso.",
      ) !== null,
    ).toBe(true);
    expect(button(`Usar o alerta ${CODE.title}`) !== null).toBe(true);
  });
});

describe("the alert input of a workflow (issue #79)", () => {
  const chooseWorkflow = async (name: string) => {
    await settleMaybe(() => screen.queryByRole("option", { name }) !== null);
    const select = screen.queryByRole("combobox", { name: "Workflow" });
    expect(select !== null).toBe(true);
    if (select) {
      await act(async () => {
        fireEvent.change(select, { target: { value: name } });
      });
    }
  };

  test("a workflow that asks for an alert gets the button, and picking fills the input", async () => {
    setup({ dialog: true });
    await chooseWorkflow("alert-fixer");
    expect(button("Choose an alert") !== null).toBe(true);
    await open();
    await press(`Use alert ${CODE.title}`);
    await settleMaybe(() => dialog("Choose an alert") === null);
    const input = screen.queryByRole("textbox", { name: "Input alert" }) as HTMLInputElement | null;
    expect(input?.value).toBe(CODE.text);
  });

  test("a workflow with other inputs gets no button", async () => {
    setup({ dialog: true, workflows: [{ name: "feature", inputs: ["task"] }] });
    await chooseWorkflow("feature");
    expect(screen.queryByRole("textbox", { name: "Input task" }) !== null).toBe(true);
    expect(button("Choose an alert") === null).toBe(true);
  });
});
